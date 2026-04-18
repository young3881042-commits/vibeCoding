import { useEffect, useMemo, useRef, useState } from 'react';

async function api(path, { token, headers, ...init } = {}) {
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
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function labelForPath(path) {
  if (!path) return 'Workspace';
  const tokens = path.split('/').filter(Boolean);
  return tokens[tokens.length - 1] || 'Workspace';
}

function GeminiTurn({ turn }) {
  return (
    <article className={`assistantTurn ${turn.role}`}>
      <div className={`assistantAvatar ${turn.role}`}>{turn.role === 'user' ? '나' : 'G'}</div>
      <div className={`assistantBubble ${turn.role}`}>
        {turn.role === 'user' ? (
          <p>{turn.prompt}</p>
        ) : (
          <pre className="assistantPre">{turn.output || '응답이 비어 있습니다.'}</pre>
        )}
        {turn.workingDirectory !== undefined ? (
          <div className="assistantMetaLine">
            <span>{turn.timedOut ? 'timeout' : turn.exitCode === 0 ? 'completed' : `exit ${turn.exitCode}`}</span>
            <span>{turn.workingDirectory ? `/${turn.workingDirectory}` : '/workspace'}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function GeminiComposer({ loading, prompt, setPrompt, onSubmit }) {
  return (
    <form
      className="assistantComposer"
      onSubmit={(event) => {
        event.preventDefault();
        const value = prompt.trim();
        if (!value || loading) {
          return;
        }
        onSubmit(value);
      }}
    >
      <textarea
        value={prompt}
        rows="3"
        placeholder="Gemini에 작업을 요청하세요. 예: 현재 폴더 기준으로 README를 정리해줘"
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            const value = prompt.trim();
            if (!value || loading) {
              return;
            }
            onSubmit(value);
          }
        }}
      />
      <div className="assistantComposerBar">
        <span>현재 선택 경로에서 `gprompt` one-shot 실행 결과를 바로 보여줍니다.</span>
        <button type="submit" className="ragSendButton" disabled={loading}>
          {loading ? 'Running' : 'Send to Gemini'}
        </button>
      </div>
    </form>
  );
}

export default function GeminiApp({
  authToken = '',
  directoryPath = '',
  filePath = '',
  embedded = false
}) {
  const [prompt, setPrompt] = useState('');
  const [turns, setTurns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const scrollRef = useRef(null);

  const contextLabel = filePath
    ? `현재 파일 · ${filePath}`
    : directoryPath
      ? `현재 폴더 · ${directoryPath}`
      : '워크스페이스 루트';

  const suggestions = useMemo(() => {
    if (filePath) {
      return [
        `${labelForPath(filePath)} 구조를 빠르게 설명해줘`,
        `${labelForPath(filePath)}를 더 읽기 쉽게 정리해줘`,
        `${labelForPath(filePath)} 기준으로 다음 수정안을 제안해줘`
      ];
    }
    if (directoryPath) {
      return [
        '현재 폴더 구조를 보고 해야 할 작업을 정리해줘',
        '현재 폴더에서 중요한 파일부터 읽고 개선 포인트를 정리해줘',
        '현재 폴더 기준으로 문서와 코드 구조를 더 직관적으로 바꿔줘'
      ];
    }
    return [
      '현재 워크스페이스에서 가장 먼저 정리할 부분을 찾아줘',
      '이 저장소를 빠르게 파악하고 작업 순서를 제안해줘',
      '현재 기준으로 README 초안을 만들어줘'
    ];
  }, [directoryPath, filePath]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [turns, loading, message]);

  const handleSubmit = async (value) => {
    setLoading(true);
    setMessage('');
    setTurns((current) => [...current, { role: 'user', prompt: value }]);
    setPrompt('');
    try {
      const response = await api('/api/workspace/gemini', {
        method: 'POST',
        token: authToken,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: value, directoryPath, filePath })
      });
      setTurns((current) => [...current, { role: 'assistant', ...response }]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={`assistantShell ${embedded ? 'embedded' : ''}`}>
      <section className="assistantPanel">
        <header className="assistantHeader">
          <div>
            <span className="assistantLabel">Gemini Workspace</span>
            <h1>지금 선택한 경로에 바로 작업 요청</h1>
            <p className="assistantSubcopy">{contextLabel}</p>
          </div>
          <div className="assistantHeaderActions">
            <span className="assistantBadge">gprompt bridge</span>
            <button type="button" className="ghostButton compact" onClick={() => setTurns([])} disabled={!turns.length || loading}>
              Clear
            </button>
          </div>
        </header>

        {!turns.length ? (
          <section className="assistantHero">
            <div className="assistantHeroCard">
              <strong>즉시 실행</strong>
              <p>현재 파일이나 폴더를 기준으로 Gemini CLI를 바로 호출합니다.</p>
            </div>
            <div className="assistantHeroCard">
              <strong>맥락 유지</strong>
              <p>파일을 선택하면 그 상위 폴더에서, 폴더를 고르면 그 폴더에서 실행합니다.</p>
            </div>
            <div className="assistantHeroCard">
              <strong>결과 중심</strong>
              <p>터미널 로그 대신 요청과 응답을 카드형 대화로 정리해 보여줍니다.</p>
            </div>
          </section>
        ) : null}

        <div className="assistantSuggestionRail">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="assistantSuggestion"
              disabled={loading}
              onClick={() => {
                setPrompt(suggestion);
                handleSubmit(suggestion);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>

        <div className="assistantStream" ref={scrollRef}>
          {!turns.length ? (
            <section className="assistantEmpty">
              <h2>Gemini에게 바로 시켜보세요</h2>
              <p>파일 수정, 요약, 구조 정리 같은 요청을 현재 경로 기준으로 실행합니다.</p>
            </section>
          ) : null}
          {turns.map((turn, index) => (
            <GeminiTurn key={`${turn.role}-${index}`} turn={turn} />
          ))}
          {loading ? (
            <article className="assistantTurn assistant">
              <div className="assistantAvatar assistant">G</div>
              <div className="assistantBubble assistant loading">
                <p>Gemini가 현재 워크스페이스에서 작업 중입니다.</p>
              </div>
            </article>
          ) : null}
          {message ? <p className="ragInlineError">{message}</p> : null}
        </div>

        <GeminiComposer
          loading={loading}
          prompt={prompt}
          setPrompt={setPrompt}
          onSubmit={handleSubmit}
        />
      </section>
    </main>
  );
}
