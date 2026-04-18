import { useEffect, useMemo, useRef, useState } from 'react';

async function api(path, { token, json = true, headers, ...init } = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {})
    }
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `HTTP ${response.status}`);
  }

  if (!json) {
    return response;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function labelForPath(path) {
  if (!path) return 'Workspace';
  const tokens = path.split('/').filter(Boolean);
  return tokens[tokens.length - 1] || 'Workspace';
}

function RagMessage({ turn }) {
  if (turn.role === 'user') {
    return (
      <article className="assistantTurn user">
        <div className="assistantAvatar user">나</div>
        <div className="assistantBubble user">
          <p>{turn.question}</p>
        </div>
      </article>
    );
  }

  return (
    <article className="assistantTurn assistant">
      <div className="assistantAvatar assistant">R</div>
      <div className="assistantBubble assistant">
        <div className="assistantRichText">
          {turn.answer.split('\n').map((line, index) => <p key={index}>{line}</p>)}
        </div>
        {turn.citations?.length ? (
          <div className="assistantCitationGrid">
            {turn.citations.map((citation) => (
              <section className="assistantCitationCard" key={`${citation.documentId}-${citation.chunkIndex}`}>
                <div className="assistantCitationTop">
                  <strong>{citation.documentTitle}</strong>
                  <span>{citation.score.toFixed(2)}</span>
                </div>
                <p>{citation.excerpt}</p>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function RagComposer({ loading, question, setQuestion, onSubmit }) {
  return (
    <form
      className="assistantComposer"
      onSubmit={(event) => {
        event.preventDefault();
        const value = question.trim();
        if (!value || loading) {
          return;
        }
        onSubmit(value);
      }}
    >
      <textarea
        value={question}
        rows="3"
        placeholder="문서 기반으로 답을 찾고 싶은 질문을 입력하세요"
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            const value = question.trim();
            if (!value || loading) {
              return;
            }
            onSubmit(value);
          }
        }}
      />
      <div className="assistantComposerBar">
        <span>Gemini + 현재 워크스페이스 문맥 + 업로드 문서 검색을 함께 사용합니다.</span>
        <button type="submit" className="ragSendButton" disabled={loading}>
          {loading ? 'Searching' : 'Ask RAG'}
        </button>
      </div>
    </form>
  );
}

export default function RagApp({
  authToken = '',
  directoryPath = '',
  filePath = '',
  persistToWorkspace = Boolean(authToken),
  topK = 4,
  pageTitle = 'RAG',
  defaultQuestion = 'Indexed docs에서 API 지연 시 먼저 확인할 항목은 무엇인가?',
  embedded = false
}) {
  const [documents, setDocuments] = useState([]);
  const [turns, setTurns] = useState([]);
  const [question, setQuestion] = useState(defaultQuestion);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState('');
  const scrollRef = useRef(null);
  const uploadRef = useRef(null);
  const saveEnabled = Boolean(authToken && persistToWorkspace);

  const contextLabel = filePath
    ? `현재 파일 · ${filePath}`
    : directoryPath
      ? `현재 폴더 · ${directoryPath}`
      : '워크스페이스 선택 없음';

  const suggestions = useMemo(() => {
    if (filePath) {
      return [
        `${labelForPath(filePath)}와 관련된 문서 기준으로 먼저 확인할 항목은?`,
        `${labelForPath(filePath)} 변경 전에 참고할 배경 문서를 요약해줘`,
        `${labelForPath(filePath)} 작업에 필요한 운영 문서를 찾아줘`
      ];
    }
    if (directoryPath) {
      return [
        '현재 폴더와 관련된 업로드 문서에서 먼저 볼 내용을 요약해줘',
        '현재 폴더 작업 전에 확인해야 할 운영 메모를 정리해줘',
        '현재 폴더 기준으로 관련 문서들의 핵심 차이를 알려줘'
      ];
    }
    return [
      '현재 업로드된 문서에서 장애 대응 체크리스트를 찾아줘',
      '색인 문서에서 운영 가이드를 요약해줘',
      '문서 기준으로 아키텍처 핵심 포인트를 3개로 정리해줘'
    ];
  }, [directoryPath, filePath]);

  const loadDocuments = async () => {
    try {
      const data = await api('/api/rag/documents', { token: authToken });
      setDocuments(data || []);
      setMessage('');
    } catch (error) {
      setMessage(error.message);
    }
  };

  useEffect(() => {
    document.title = pageTitle;
    loadDocuments();
  }, [pageTitle, authToken]);

  useEffect(() => {
    setQuestion(defaultQuestion);
  }, [defaultQuestion]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [turns, loading, uploading, message]);

  const handleAsk = async (value) => {
    setLoading(true);
    setMessage('');
    setTurns((current) => [...current, { role: 'user', question: value }]);
    setQuestion('');

    try {
      const path = saveEnabled ? '/api/rag/query-and-save' : '/api/rag/query';
      const payload = saveEnabled
        ? { question: value, topK, directoryPath: directoryPath || null, filePath: filePath || null }
        : { question: value, topK };
      const response = await api(path, {
        method: 'POST',
        token: authToken,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setTurns((current) => [...current, { role: 'assistant', ...response }]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const uploadFiles = async (files) => {
    if (!files.length) {
      return;
    }
    setUploading(true);
    setMessage('');
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        await api('/api/rag/documents', {
          method: 'POST',
          token: authToken,
          body: form
        });
      }
      await loadDocuments();
      setMessage(`${files.length}개 문서를 색인 목록에 추가했습니다.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
    }
  };

  const importWorkspaceSelection = async (selection = {}) => {
    const payload = {
      directoryPath: selection.type === 'dir' ? selection.path : selection.directoryPath || directoryPath || null,
      filePath: selection.type === 'file' ? selection.path : selection.filePath || filePath || null
    };
    if (!payload.directoryPath && !payload.filePath) {
      setMessage('먼저 폴더나 파일을 선택하세요.');
      return;
    }
    setUploading(true);
    setMessage('');
    try {
      const imported = await api('/api/rag/documents/workspace', {
        method: 'POST',
        token: authToken,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      await loadDocuments();
      setMessage(`${(imported || []).length}개 워크스페이스 파일을 RAG 문서로 가져왔습니다.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setDragging(false);
    const workspacePayload = event.dataTransfer.getData('application/x-jupiter-workspace');
    if (workspacePayload) {
      try {
        await importWorkspaceSelection(JSON.parse(workspacePayload));
        return;
      } catch (error) {
        setMessage(error.message);
        return;
      }
    }
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) {
      await uploadFiles(files);
    }
  };

  return (
    <main className={`assistantShell ${embedded ? 'embedded' : ''}`}>
      <input
        ref={uploadRef}
        type="file"
        hidden
        multiple
        accept=".txt,.md,.csv,.json,.log,.yaml,.yml"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          uploadFiles(files).finally(() => {
            event.target.value = '';
          });
        }}
      />
      <section
        className={`assistantPanel ragPanel ${dragging ? 'dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) {
            return;
          }
          setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <header className="assistantHeader">
          <div>
            <span className="assistantLabel">RAG Workspace</span>
            <h1>선택한 폴더와 문서를 같이 읽는 문서형 Gemini</h1>
            <p className="assistantSubcopy">{contextLabel}</p>
          </div>
          <div className="assistantHeaderActions">
            <span className="assistantBadge">{documents.length} docs</span>
            <button type="button" className="ghostButton compact" onClick={loadDocuments} disabled={loading || uploading}>
              Refresh
            </button>
            <button type="button" className="ghostButton compact" onClick={() => importWorkspaceSelection()} disabled={loading || uploading}>
              현재 선택 올리기
            </button>
            <button type="button" className="ragTopButton primary" onClick={() => uploadRef.current?.click()} disabled={loading || uploading}>
              파일 올리기
            </button>
          </div>
        </header>

        <section className="assistantHero">
          <div className="assistantHeroCard">
            <strong>문서 업로드</strong>
            <p>`.md`, `.txt`, `.json` 같은 문서를 끌어다 놓으면 즉시 색인합니다.</p>
          </div>
          <div className="assistantHeroCard">
            <strong>폴더 가져오기</strong>
            <p>현재 선택한 폴더를 그대로 RAG 문서로 올려서 문맥 검색 범위를 늘릴 수 있습니다.</p>
          </div>
          <div className="assistantHeroCard">
            <strong>드래그 연결</strong>
            <p>가운데 파일 목록에서 파일이나 폴더를 이 패널로 끌어오면 바로 RAG 문서로 가져옵니다.</p>
          </div>
        </section>

        <div className="assistantSuggestionRail">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="assistantSuggestion"
              disabled={loading}
              onClick={() => {
                setQuestion(suggestion);
                handleAsk(suggestion);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>

        {documents.length ? (
          <section className="assistantDocumentRail">
            {documents.slice(0, 4).map((document) => (
              <article className="assistantDocumentCard" key={document.id}>
                <strong>{document.title}</strong>
                <span>{document.filename}</span>
                <p>{document.preview}</p>
              </article>
            ))}
          </section>
        ) : null}

        <div className="assistantStream" ref={scrollRef}>
          {!turns.length ? (
            <section className="assistantEmpty">
              <h2>문서와 현재 선택 경로를 같이 참조합니다</h2>
              <p>업로드 문서, 현재 폴더, 현재 파일을 같이 엮어 답을 찾습니다.</p>
            </section>
          ) : null}
          {turns.map((turn, index) => <RagMessage key={`${turn.role}-${index}`} turn={turn} />)}
          {loading ? (
            <article className="assistantTurn assistant">
              <div className="assistantAvatar assistant">R</div>
              <div className="assistantBubble assistant loading">
                <p>관련 문서와 현재 선택 경로를 함께 검색하고 있습니다.</p>
              </div>
            </article>
          ) : null}
          {uploading ? (
            <article className="assistantTurn assistant">
              <div className="assistantAvatar assistant">R</div>
              <div className="assistantBubble assistant loading">
                <p>문서를 가져오고 색인하는 중입니다.</p>
              </div>
            </article>
          ) : null}
          {message ? <p className="ragInlineError">{message}</p> : null}
        </div>

        <RagComposer
          loading={loading}
          question={question}
          setQuestion={setQuestion}
          onSubmit={handleAsk}
        />
      </section>
    </main>
  );
}
