import { useEffect, useRef, useState } from 'react';

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

function workspacePathFor(path) {
  return path ? `/workspace/${path}` : '/workspace';
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

  const contextPath = workspacePathFor(directoryPath || (filePath ? filePath.split('/').slice(0, -1).join('/') : ''));

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
        <header className="assistantHeader assistantHeaderMinimal">
          <code className="assistantPathPill">{contextPath}</code>
          <div className="assistantHeaderActions">
            <button type="button" className="ghostButton compact" onClick={() => setTurns([])} disabled={!turns.length || loading}>
              Clear
            </button>
          </div>
        </header>

        <div className="assistantStream" ref={scrollRef}>
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
