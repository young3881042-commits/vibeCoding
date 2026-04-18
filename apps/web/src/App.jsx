import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';

const AUTH_KEY = 'codex-workspace-auth';
const LazyCodeEditor = lazy(() => import('./CodeEditor.jsx'));
const LazyGeminiApp = lazy(() => import('./GeminiApp.jsx'));
const LazyRagApp = lazy(() => import('./RagApp.jsx'));

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      localStorage.removeItem(AUTH_KEY);
      window.location.reload();
      throw new Error('Session expired');
    }
    throw new Error((await response.text()) || `HTTP ${response.status}`);
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

async function requestText(path, token) {
  const response = await fetch(path, { headers: authHeaders(token) });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      localStorage.removeItem(AUTH_KEY);
      window.location.reload();
      throw new Error('Session expired');
    }
    throw new Error((await response.text()) || `HTTP ${response.status}`);
  }
  return response.text();
}

function joinPath(base, name) {
  return base ? `${base}/${name}` : name;
}

function labelForPath(path) {
  if (!path) return 'Workspace';
  const tokens = path.split('/').filter(Boolean);
  return tokens[tokens.length - 1] || 'Workspace';
}

function workspacePathFor(path) {
  return path ? `/workspace/${path}` : '/workspace';
}

function extensionForPath(path) {
  const fileName = labelForPath(path);
  const index = fileName.lastIndexOf('.');
  if (index === -1 || index === fileName.length - 1) {
    return 'text';
  }
  return fileName.slice(index + 1).toLowerCase();
}

function formatSize(size) {
  if (!size) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function readStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function parentPathOf(path) {
  if (!path) return '';
  const tokens = path.split('/').filter(Boolean);
  tokens.pop();
  return tokens.join('/');
}

function monitorUrls() {
  const host = window.location.hostname || '192.168.45.101';
  return {
    grafana: `http://${host}:30300`,
    prometheus: `http://${host}:30090`
  };
}

function validateAuthForm(mode, username, password) {
  const trimmedUsername = username.trim();
  if (!trimmedUsername) {
    return '아이디를 입력하세요.';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmedUsername)) {
    return '아이디는 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.';
  }
  if (trimmedUsername.length > 40) {
    return '아이디는 40자 이하여야 합니다.';
  }
  if (!password.trim()) {
    return '비밀번호를 입력하세요.';
  }
  if (password.length < 4) {
    return mode === 'signup'
      ? '회원가입 비밀번호는 4자 이상이어야 합니다.'
      : '비밀번호는 4자 이상이어야 합니다.';
  }
  if (password.length > 100) {
    return '비밀번호는 100자 이하여야 합니다.';
  }
  return '';
}

function ToolbarIcon({ children }) {
  return (
    <span className="toolbarIcon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

function AuthScreen({ mode, setMode, username, setUsername, password, setPassword, onSubmit, loading, error }) {
  const validationError = validateAuthForm(mode, username, password);
  const disabled = loading || Boolean(validationError);

  return (
    <main className="loginShell">
      <section className="loginCard">
        <span className="sidebarEyebrow">Workspace Access</span>
        <h1>간편 회원가입 후 바로 작업공간을 엽니다</h1>
        <p>일반 사용자는 자기 디렉터리만 보고, 관리자는 전체 디렉터리와 런처 링크를 봅니다.</p>
        <label className="loginField">
          <span>ID</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="my-id" />
        </label>
        <label className="loginField">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="password" />
        </label>
        <div className="authSwitch">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>로그인</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>회원가입</button>
        </div>
        <button type="button" className="loginButton" onClick={onSubmit} disabled={disabled}>
          {loading ? '처리 중...' : mode === 'login' ? 'Login' : 'Sign Up'}
        </button>
        {error || validationError ? <div className="loginHint">{error || validationError}</div> : null}
      </section>
    </main>
  );
}

function DirectoryTree({ path, depth = 0, selectedPath, expandedPaths, treeMap, loadingPaths, onToggle, onSelect }) {
  const node = treeMap.get(path);
  const entries = node?.entries?.filter((entry) => entry.type === 'dir') || [];

  return (
    <div className="treeLevel">
      {entries.map((entry) => {
        const nextPath = entry.path;
        const expanded = expandedPaths.includes(nextPath);
        const selected = selectedPath === nextPath;
        const loading = loadingPaths.includes(nextPath);

        return (
          <div key={nextPath} className="treeNode" style={{ '--depth': depth }}>
            <div className={`treeRow ${selected ? 'selected' : ''}`}>
              <button type="button" className="treeToggle" onClick={() => onToggle(nextPath)}>
                {expanded ? '−' : '+'}
              </button>
              <button type="button" className="treeLabel" onClick={() => onSelect(nextPath)}>
                {entry.name}
              </button>
              {loading ? <span className="treeState">…</span> : null}
            </div>
            {expanded ? (
              <DirectoryTree
                path={nextPath}
                depth={depth + 1}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                treeMap={treeMap}
                loadingPaths={loadingPaths}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Sidebar({ auth, onOpenLauncher, onLogout, selectedPath, expandedPaths, treeMap, loadingPaths, onToggle, onSelect }) {
  const root = treeMap.get('');
  const rootFolders = root?.entries?.filter((entry) => entry.type === 'dir') || [];

  return (
    <aside className="browserSidebar">
      <div className="sidebarHead">
        <span className="sidebarEyebrow">{auth.role}</span>
        <h1>{auth.username}</h1>
        <div className="sidebarActions">
          {auth.launcherUrl ? (
            <button type="button" className="ghostButton" onClick={onOpenLauncher}>
              Launcher
            </button>
          ) : null}
          <button type="button" className="ghostButton" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="sidebarTree">
        <div className="treeRoot">
          <button type="button" className={`treeRootLabel ${selectedPath === '' ? 'selected' : ''}`} onClick={() => onSelect('')}>
            Workspace Root
          </button>
        </div>
        {rootFolders.map((entry) => {
          const expanded = expandedPaths.includes(entry.path);
          const selected = selectedPath === entry.path;
          const loading = loadingPaths.includes(entry.path);
          return (
            <div key={entry.path} className="treeNode" style={{ '--depth': 0 }}>
              <div className={`treeRow ${selected ? 'selected' : ''}`}>
                <button type="button" className="treeToggle" onClick={() => onToggle(entry.path)}>
                  {expanded ? '−' : '+'}
                </button>
                <button type="button" className="treeLabel" onClick={() => onSelect(entry.path)}>
                  {entry.name}
                </button>
                {loading ? <span className="treeState">…</span> : null}
              </div>
              {expanded ? (
                <DirectoryTree
                  path={entry.path}
                  depth={1}
                  selectedPath={selectedPath}
                  expandedPaths={expandedPaths}
                  treeMap={treeMap}
                  loadingPaths={loadingPaths}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function AccountEditDialog({
  auth,
  open,
  loading,
  error,
  currentPassword,
  newPassword,
  confirmPassword,
  onCurrentPassword,
  onNewPassword,
  onConfirmPassword,
  onClose,
  onSubmit
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="modalOverlay" onClick={onClose}>
      <section className="accountDialog" onClick={(event) => event.stopPropagation()}>
        <div className="accountDialogHeader">
          <div>
            <span className="panelEyebrow">Account Edit</span>
            <h2>{auth.username}</h2>
            <p className="panelSubcopy">비밀번호를 변경할 수 있습니다.</p>
          </div>
          <button type="button" className="ghostButton compact" onClick={onClose}>닫기</button>
        </div>
        <div className="accountDialogBody">
          <label className="loginField">
            <span>Current Password</span>
            <input type="password" value={currentPassword} onChange={(event) => onCurrentPassword(event.target.value)} placeholder="현재 비밀번호" />
          </label>
          <label className="loginField">
            <span>New Password</span>
            <input type="password" value={newPassword} onChange={(event) => onNewPassword(event.target.value)} placeholder="새 비밀번호" />
          </label>
          <label className="loginField">
            <span>Confirm Password</span>
            <input type="password" value={confirmPassword} onChange={(event) => onConfirmPassword(event.target.value)} placeholder="새 비밀번호 확인" />
          </label>
          {error ? <div className="loginHint">{error}</div> : null}
        </div>
        <div className="accountDialogFooter">
          <button type="button" className="ghostButton" onClick={onClose}>취소</button>
          <button type="button" className="sendButton" onClick={onSubmit} disabled={loading}>
            {loading ? '저장 중...' : '저장'}
          </button>
        </div>
      </section>
    </div>
  );
}

function WorkspaceHeader({
  auth,
  selectedPath,
  rightPanel,
  setRightPanel,
  userMenuOpen,
  setUserMenuOpen,
  onOpenLauncher,
  onOpenAccountEdit,
  onLogout
}) {
  return (
    <header className="workspaceTopbar">
      <section className="workspacePathCard">
        <span className="panelEyebrow">Current Directory</span>
        <code className="workspacePathCode">{workspacePathFor(selectedPath)}</code>
      </section>
      <div className="workspaceUserTray">
        <div className="workspaceTopTabs">
          <button type="button" className={`ghostButton compact ${rightPanel === 'rag' ? 'active' : ''}`} onClick={() => setRightPanel('rag')}>RAG</button>
          <button type="button" className={`ghostButton compact ${rightPanel === 'gemini' ? 'active' : ''}`} onClick={() => setRightPanel('gemini')}>Gemini</button>
          <button type="button" className={`ghostButton compact ${rightPanel === 'editor' ? 'active' : ''}`} onClick={() => setRightPanel('editor')}>파일 편집기</button>
          {auth.role === 'ADMIN' ? (
            <button type="button" className={`ghostButton compact ${rightPanel === 'monitor' ? 'active' : ''}`} onClick={() => setRightPanel('monitor')}>모니터링</button>
          ) : null}
        </div>
        {auth.launcherUrl ? (
          <button type="button" className="ghostButton" onClick={onOpenLauncher}>
            Launcher
          </button>
        ) : null}
        <div className="userMenuWrap">
          <button
            type="button"
            className={`workspaceUserButton ${userMenuOpen ? 'open' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              setUserMenuOpen((current) => !current);
            }}
          >
            <span>{auth.role}</span>
            <strong>{auth.username}</strong>
          </button>
          {userMenuOpen ? (
            <div className="userMenuDropdown" onClick={(event) => event.stopPropagation()}>
              <button type="button" onClick={onOpenAccountEdit}>Edit</button>
              <button type="button" onClick={onLogout}>Logout</button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function FileList({
  currentTree,
  selectedPath,
  selectedFile,
  createDraft,
  setCreateDraft,
  filter,
  onFilter,
  onOpen,
  onOpenDir,
  onRunPython,
  onRename,
  onRefresh,
  onGoParent,
  onNewFile,
  onNewFolder,
  onUploadClick,
  onContextMenu,
  contextMenu
}) {
  const [renameDraft, setRenameDraft] = useState(null);

  const files = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const sorted = currentTree.entries
      .slice()
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === 'dir' ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
    if (!keyword) return sorted;
    return sorted.filter((entry) => entry.name.toLowerCase().includes(keyword));
  }, [currentTree.entries, filter]);

  const submitCreateDraft = async () => {
    if (!createDraft?.name?.trim()) {
      return;
    }
    const name = createDraft.name.trim();
    const basePath = createDraft.basePath || '';
    if (createDraft.kind === 'file') {
      await onNewFile(basePath, name);
    } else {
      await onNewFolder(basePath, name);
    }
    setCreateDraft(null);
  };

  const submitRenameDraft = async () => {
    if (!renameDraft?.name?.trim() || renameDraft.name.trim() === labelForPath(renameDraft.path)) {
      setRenameDraft(null);
      return;
    }
    await onRename(renameDraft.path, renameDraft.name.trim());
    setRenameDraft(null);
  };

  return (
    <section className="browserListPanel" onContextMenu={(event) => onContextMenu(event, currentTree.currentPath || '', false, false, false)}>
      <div className="panelTop simple">
        <div className="listActionBar">
          <button type="button" className="iconButton actionIconButton" title="상위 폴더로 이동" aria-label="상위 폴더로 이동" onClick={onGoParent}>
            <ToolbarIcon>
              <path d="M9 7 4 12l5 5" />
              <path d="M20 12H4" />
            </ToolbarIcon>
          </button>
          <button type="button" className="iconButton actionIconButton" title="새로고침" aria-label="새로고침" onClick={onRefresh}>
            <ToolbarIcon>
              <path d="M20 11a8 8 0 1 0 2 5.5" />
              <path d="M20 4v7h-7" />
            </ToolbarIcon>
          </button>
          <button type="button" className="iconButton actionIconButton primary" title="파일 업로드" aria-label="파일 업로드" onClick={onUploadClick}>
            <ToolbarIcon>
              <path d="M12 16V5" />
              <path d="m7 10 5-5 5 5" />
              <path d="M5 19h14" />
            </ToolbarIcon>
          </button>
        </div>
        <div className="listFilterGroup">
          <input value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="파일명 검색" />
        </div>
      </div>
      <div className="entryList">
        {files.map((entry) => (
          <div
            key={entry.path}
            className={`entryRow ${selectedFile === entry.path || selectedPath === entry.path ? 'active' : ''}`}
            onContextMenu={(event) => onContextMenu(event, entry.path, entry.type === 'file', true, true)}
          >
            <div
              role="button"
              tabIndex={0}
              className="entryMain"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('application/x-jupiter-workspace', JSON.stringify({
                  path: entry.path,
                  type: entry.type
                }));
                event.dataTransfer.setData('text/plain', entry.path);
              }}
              onClick={() => {
                if (renameDraft?.path === entry.path) {
                  return;
                }
                if (entry.type === 'dir') {
                  onOpenDir(entry.path);
                } else {
                  onOpen(entry.path);
                }
              }}
              onKeyDown={(event) => {
                if (renameDraft?.path === entry.path) {
                  return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (entry.type === 'dir') {
                    onOpenDir(entry.path);
                  } else {
                    onOpen(entry.path);
                  }
                }
              }}
            >
              <div className="entryMeta">
                <span className={`entryType ${entry.type}`}>{entry.type === 'dir' ? 'DIR' : extensionForPath(entry.path).toUpperCase()}</span>
                <div className="entryText">
                  {renameDraft?.path === entry.path ? (
                    <input
                      className="inlineNameInput"
                      value={renameDraft.name}
                      autoFocus
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setRenameDraft((current) => ({ ...current, name: event.target.value }))}
                      onBlur={() => { submitRenameDraft().catch(() => {}); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          submitRenameDraft().catch(() => {});
                        }
                        if (event.key === 'Escape') {
                          setRenameDraft(null);
                        }
                      }}
                    />
                  ) : (
                    <strong>{entry.name}</strong>
                  )}
                </div>
              </div>
              <span className="entrySize">{formatSize(entry.size)}</span>
            </div>
            {extensionForPath(entry.path) === 'py' ? (
              <button type="button" className="runButton" onClick={() => onRunPython(entry.path)} title="Python 실행">
                &gt;
              </button>
            ) : null}
          </div>
        ))}
        {!files.length && !createDraft ? <p className="emptyNotice">이 경로에는 조건에 맞는 파일이 없습니다.</p> : null}
        {createDraft ? (
          <div className="entryRow createDraftRow">
            <div className="createDraftKinds">
              <button
                type="button"
                className={`ghostButton compact ${createDraft.kind === 'file' ? 'active' : ''}`}
                onClick={() => setCreateDraft((current) => ({ ...current, kind: 'file' }))}
              >
                File
              </button>
              <button
                type="button"
                className={`ghostButton compact ${createDraft.kind === 'folder' ? 'active' : ''}`}
                onClick={() => setCreateDraft((current) => ({ ...current, kind: 'folder' }))}
              >
                Folder
              </button>
            </div>
            <input
              className="inlineNameInput createDraftInput"
              value={createDraft.name}
              autoFocus
              placeholder={createDraft.kind === 'file' ? '파일 이름' : '폴더 이름'}
              onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitCreateDraft().catch(() => {});
                }
                if (event.key === 'Escape') {
                  setCreateDraft(null);
                }
              }}
            />
            <button type="button" className="ghostButton compact" onClick={() => setCreateDraft(null)}>취소</button>
            <button type="button" className="sendButton compactStrong" onClick={() => submitCreateDraft().catch(() => {})}>만들기</button>
          </div>
        ) : null}
      </div>
      <div className="listFooter">
        <button
          type="button"
          className="iconButton actionIconButton"
          title="새 항목 만들기"
          aria-label="새 항목 만들기"
          onClick={() => setCreateDraft({ kind: 'file', name: '', basePath: currentTree.currentPath || '' })}
        >
          <ToolbarIcon>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </ToolbarIcon>
        </button>
      </div>
      {contextMenu ? (
        <div className="contextMenu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          {contextMenu.renameTargetPath ? (
            <button
              type="button"
              onClick={() => {
                setRenameDraft({ path: contextMenu.renameTargetPath, name: labelForPath(contextMenu.renameTargetPath) });
                contextMenu.onClose();
              }}
            >
              이름 변경
            </button>
          ) : null}
          {contextMenu.deleteTargetPath ? (
            <button type="button" className="dangerMenuAction" onClick={contextMenu.onDelete}>삭제</button>
          ) : null}
          <button type="button" onClick={contextMenu.onNewFile}>새 파일</button>
          <button type="button" onClick={contextMenu.onNewFolder}>새 폴더</button>
          <button type="button" onClick={contextMenu.onUpload}>업로드</button>
          <button type="button" onClick={contextMenu.onRefresh}>새로고침</button>
        </div>
      ) : null}
    </section>
  );
}

function EditorPanel({ selectedFile, content, setContent, loading, error, outputState, onSave, onDelete, onDownload }) {
  const hasOutput = outputState.command || outputState.stdout || outputState.stderr;
  return (
    <section className="browserPreviewPanel">
      <div className="editorHeader">
        <div>
          <span className="panelEyebrow">File</span>
          <h2>{selectedFile ? labelForPath(selectedFile) : '파일을 선택하세요'}</h2>
          {selectedFile ? <p className="panelSubcopy">{selectedFile}</p> : null}
        </div>
        {selectedFile ? (
          <div className="chatHeaderActions">
            <button type="button" className="ghostButton compact" onClick={onDownload}>Download</button>
            <button type="button" className="ghostButton compact" onClick={onDelete}>Delete</button>
            <button type="button" className="sendButton" onClick={onSave}>Save</button>
          </div>
        ) : null}
      </div>
      {loading ? <p className="previewState">파일을 불러오는 중입니다.</p> : null}
      {error ? <p className="previewError">{error}</p> : null}
      {!loading && !error && !selectedFile ? <div className="previewEmpty"><p>왼쪽에서 폴더를 고르고 가운데에서 파일을 선택하세요.</p></div> : null}
      {!loading && selectedFile ? (
        <>
          <div className="editorCodeWrap">
            <Suspense fallback={<div className="editorLoading">편집기를 불러오는 중입니다.</div>}>
              <LazyCodeEditor
                path={selectedFile}
                value={content}
                onChange={(value) => setContent(value)}
                onSave={onSave}
              />
            </Suspense>
          </div>
          <div className="editorOutputSection">
            <div className="editorOutputHeader">
              <strong>Output Log</strong>
              {outputState.command ? <span className="statusMeta">{outputState.command}</span> : null}
            </div>
            {outputState.running ? <p className="previewState">실행 중입니다.</p> : null}
            {!outputState.running && !hasOutput ? (
              <div className="previewEmpty"><p>`.py` 파일 오른쪽 실행 버튼을 누르면 이 파일 아래에 실행 로그가 표시됩니다.</p></div>
            ) : null}
            {hasOutput ? (
              <div className="outputShell">
                {outputState.stdout ? (
                  <>
                    <strong className="outputLabel">stdout</strong>
                    <pre className="outputBlock">{outputState.stdout}</pre>
                  </>
                ) : null}
                {outputState.stderr ? (
                  <>
                    <strong className="outputLabel">stderr</strong>
                    <pre className="outputBlock error">{outputState.stderr}</pre>
                  </>
                ) : null}
                {!outputState.timedOut ? (
                  <p className="statusMeta">exit code: {outputState.exitCode}</p>
                ) : (
                  <p className="statusMeta">실행 시간이 초과되어 종료했습니다.</p>
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function AdminMonitorPanel({ activeMonitor, setActiveMonitor }) {
  const monitors = monitorUrls();
  const currentUrl = activeMonitor === 'prometheus' ? monitors.prometheus : monitors.grafana;

  return (
    <section className="browserPreviewPanel">
      <div className="editorHeader">
        <div>
          <span className="panelEyebrow">Monitor</span>
          <h2>Cluster Usage</h2>
          <p className="panelSubcopy">{currentUrl}</p>
        </div>
        <div className="chatHeaderActions">
          <button type="button" className={`ghostButton compact ${activeMonitor === 'grafana' ? 'active' : ''}`} onClick={() => setActiveMonitor('grafana')}>Grafana</button>
          <button type="button" className={`ghostButton compact ${activeMonitor === 'prometheus' ? 'active' : ''}`} onClick={() => setActiveMonitor('prometheus')}>Prometheus</button>
          <button type="button" className="sendButton" onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}>Open</button>
        </div>
      </div>
      <iframe title={`${activeMonitor} monitor`} className="monitorFrame" src={currentUrl} />
    </section>
  );
}

export default function App() {
  const [authMode, setAuthMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [auth, setAuth] = useState(readStoredAuth());
  const [treeMap, setTreeMap] = useState(new Map());
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedFile, setSelectedFile] = useState('');
  const [content, setContent] = useState('');
  const [filter, setFilter] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [loadingPaths, setLoadingPaths] = useState([]);
  const [expandedPaths, setExpandedPaths] = useState([]);
  const [error, setError] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [createDraft, setCreateDraft] = useState(null);
  const [activeMonitor, setActiveMonitor] = useState('grafana');
  const [rightPanel, setRightPanel] = useState('gemini');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [accountEditOpen, setAccountEditOpen] = useState(false);
  const [accountEditLoading, setAccountEditLoading] = useState(false);
  const [accountEditError, setAccountEditError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pythonOutput, setPythonOutput] = useState({
    file: '',
    command: '',
    stdout: '',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    running: false
  });
  const uploadRef = useRef(null);

  const loadTree = async (path, force = false, token = auth?.token) => {
    if (!token) return null;
    if (!force && treeMap.has(path)) return treeMap.get(path);
    setLoadingPaths((current) => [...new Set([...current, path])]);
    try {
      const data = await requestJson(`/api/workspace/tree?path=${encodeURIComponent(path)}`, { headers: authHeaders(token) });
      setTreeMap((current) => {
        const next = new Map(current);
        next.set(path, data);
        return next;
      });
      return data;
    } finally {
      setLoadingPaths((current) => current.filter((item) => item !== path));
    }
  };

  useEffect(() => {
    document.title = 'Codex Workspace Browser';
  }, []);

  useEffect(() => {
    if (!auth?.token) {
      setRightPanel('editor');
    }
  }, [auth?.token]);

  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      setUserMenuOpen(false);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    if (!auth?.token) {
      localStorage.removeItem(AUTH_KEY);
      return;
    }
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    loadTree('', true, auth.token).catch((loadError) => setError(loadError.message));
  }, [auth]);

  useEffect(() => {
    if (!auth?.token) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      requestJson(`/api/workspace/tree?path=${encodeURIComponent(selectedPath)}`, {
        headers: authHeaders(auth.token)
      })
        .then((data) => {
          setTreeMap((current) => {
            const next = new Map(current);
            next.set(selectedPath, data);
            return next;
          });
        })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [auth?.token, selectedPath]);

  const currentTree = treeMap.get(selectedPath) || { currentPath: selectedPath, entries: [] };

  const handleAuth = async () => {
    const validationError = validateAuthForm(authMode, username, password);
    if (validationError || authLoading) {
      setAuthError(validationError);
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const session = await requestJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      setAuth(session);
      setUsername('');
      setPassword('');
    } catch (submitError) {
      setAuthError(submitError.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSelectDir = async (path) => {
    setContextMenu(null);
    setSelectedPath(path);
    setSelectedFile('');
    setContent('');
    setError('');
    await loadTree(path, false).catch((loadError) => setError(loadError.message));
  };

  const handleToggle = async (path) => {
    if (expandedPaths.includes(path)) {
      setExpandedPaths((current) => current.filter((item) => item !== path));
      return;
    }
    setExpandedPaths((current) => [...current, path]);
    await loadTree(path, false).catch((loadError) => setError(loadError.message));
  };

  const handleOpenFile = async (path) => {
    setContextMenu(null);
    setSelectedFile(path);
    setRightPanel('editor');
    setLoadingFile(true);
    setError('');
    try {
      const text = await requestText(`/api/workspace/file?path=${encodeURIComponent(path)}`, auth.token);
      setContent(text);
    } catch (loadError) {
      setError(loadError.message);
      setContent('');
    } finally {
      setLoadingFile(false);
    }
  };

  const handleRename = async (path, nextName) => {
    setContextMenu(null);
    const currentName = labelForPath(path);
    const newName = nextName?.trim();
    if (!newName || newName === currentName) {
      return;
    }
    try {
      const result = await requestJson('/api/workspace/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(auth.token) },
        body: JSON.stringify({ path, newName })
      });
      const renamedPath = result.path;
      const parent = parentPathOf(path);
      await loadTree(parent, true);
      if (selectedPath === path) {
        setSelectedPath(renamedPath);
      }
      if (selectedFile === path) {
        setSelectedFile(renamedPath);
      }
    } catch (renameError) {
      setError(renameError.message);
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    try {
      await requestJson('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(auth.token) },
        body: JSON.stringify({ path: selectedFile, content })
      });
      await loadTree(selectedPath, true);
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const handleDelete = async () => {
    if (!selectedFile) return;
    try {
      await requestJson(`/api/workspace/item?path=${encodeURIComponent(selectedFile)}`, {
        method: 'DELETE',
        headers: authHeaders(auth.token)
      });
      setSelectedFile('');
      setContent('');
      await loadTree(selectedPath, true);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const handleDeletePath = async (path) => {
    if (!path) return;
    const targetLabel = labelForPath(path);
    const confirmed = window.confirm(`'${targetLabel}' 항목을 삭제할까요?`);
    if (!confirmed) {
      return;
    }

    const parent = parentPathOf(path);
    try {
      await requestJson(`/api/workspace/item?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
        headers: authHeaders(auth.token)
      });

      if (selectedFile === path || selectedFile.startsWith(`${path}/`)) {
        setSelectedFile('');
        setContent('');
      }

      if (selectedPath === path || selectedPath.startsWith(`${path}/`)) {
        setSelectedPath(parent);
        await loadTree(parent, true);
        return;
      }

      await loadTree(parent || selectedPath, true);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const handleDownload = async () => {
    if (!selectedFile) return;
    const response = await fetch(`/api/workspace/download?path=${encodeURIComponent(selectedFile)}`, {
      headers: authHeaders(auth.token)
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = labelForPath(selectedFile);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('path', selectedPath);
    form.append('file', file);
    try {
      const response = await fetch('/api/workspace/upload', {
        method: 'POST',
        headers: authHeaders(auth.token),
        body: form
      });
      if (!response.ok) {
        throw new Error((await response.text()) || `HTTP ${response.status}`);
      }
      await loadTree(selectedPath, true);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      event.target.value = '';
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_KEY);
    setAuth(null);
    setTreeMap(new Map());
    setSelectedPath('');
    setSelectedFile('');
    setContent('');
    setFilter('');
    setError('');
    setAuthError('');
    setExpandedPaths([]);
    setContextMenu(null);
    setUserMenuOpen(false);
    setAccountEditOpen(false);
    setAccountEditError('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setCreateDraft(null);
    setRightPanel('editor');
    setPythonOutput({
      file: '',
      command: '',
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      running: false
    });
  };

  const openAccountEdit = () => {
    setUserMenuOpen(false);
    setAccountEditError('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setAccountEditOpen(true);
  };

  const closeAccountEdit = () => {
    setAccountEditOpen(false);
    setAccountEditError('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const submitAccountEdit = async () => {
    if (accountEditLoading) {
      return;
    }
    if (!currentPassword.trim()) {
      setAccountEditError('현재 비밀번호를 입력하세요.');
      return;
    }
    if (newPassword.length < 4) {
      setAccountEditError('새 비밀번호는 4자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setAccountEditError('새 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    setAccountEditLoading(true);
    setAccountEditError('');
    try {
      await requestJson('/api/auth/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(auth.token) },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      closeAccountEdit();
    } catch (submitError) {
      setAccountEditError(submitError.message);
    } finally {
      setAccountEditLoading(false);
    }
  };

  const handleRefresh = async () => {
    setContextMenu(null);
    await loadTree(selectedPath, true).catch((loadError) => setError(loadError.message));
  };

  const handleGoParent = async () => {
    const nextPath = parentPathOf(selectedPath);
    await handleSelectDir(nextPath);
  };

  const handleRunPython = async (path) => {
    setSelectedFile(path);
    setRightPanel('editor');
    setPythonOutput({
      file: path,
      command: '',
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      running: true
    });
    try {
      const result = await requestJson(`/api/workspace/run-python?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: authHeaders(auth.token)
      });
      setPythonOutput({
        file: path,
        command: result.command || '',
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0,
        timedOut: Boolean(result.timedOut),
        running: false
      });
    } catch (runError) {
      setPythonOutput({
        file: path,
        command: `python ${path}`,
        stdout: '',
        stderr: runError.message,
        exitCode: 1,
        timedOut: false,
        running: false
      });
    }
  };

  const handleCreateFile = async (basePath = selectedPath, nextName = '') => {
    setContextMenu(null);
    const previous = selectedPath;
    if (basePath !== previous) {
      setSelectedPath(basePath);
    }
    const name = nextName.trim();
    if (!name) return;
    try {
      await requestJson('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(auth.token) },
        body: JSON.stringify({ path: joinPath(basePath, name), content: '' })
      });
      await loadTree(basePath, true);
      if (basePath !== previous) {
        setSelectedPath(basePath);
      }
    } catch (createError) {
      setError(createError.message);
    }
  };

  const handleCreateFolder = async (basePath = selectedPath, nextName = '') => {
    setContextMenu(null);
    const previous = selectedPath;
    if (basePath !== previous) {
      setSelectedPath(basePath);
    }
    const name = nextName.trim();
    if (!name) return;
    try {
      await requestJson(`/api/workspace/folder?path=${encodeURIComponent(joinPath(basePath, name))}`, {
        method: 'POST',
        headers: authHeaders(auth.token)
      });
      await loadTree(basePath, true);
      if (basePath !== previous) {
        setSelectedPath(basePath);
      }
    } catch (createError) {
      setError(createError.message);
    }
  };

  const openContextMenu = (event, targetPath, isFileTarget, allowRename = false, allowDelete = false) => {
    event.preventDefault();
    event.stopPropagation();
    const basePath = isFileTarget ? parentPathOf(targetPath) : targetPath;
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      renameTargetPath: allowRename ? targetPath : '',
      deleteTargetPath: allowDelete ? targetPath : '',
      onClose: () => setContextMenu(null),
      onNewFile: () => {
        setContextMenu(null);
        if (basePath !== selectedPath) {
          setSelectedPath(basePath);
        }
        setCreateDraft({ basePath, kind: 'file', name: '' });
      },
      onNewFolder: () => {
        setContextMenu(null);
        if (basePath !== selectedPath) {
          setSelectedPath(basePath);
        }
        setCreateDraft({ basePath, kind: 'folder', name: '' });
      },
      onUpload: () => {
        setContextMenu(null);
        if (basePath !== selectedPath) {
          setSelectedPath(basePath);
        }
        uploadRef.current?.click();
      },
      onDelete: async () => {
        setContextMenu(null);
        await handleDeletePath(targetPath);
      },
      onRefresh: handleRefresh
    });
  };

  if (!auth?.token) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        onSubmit={handleAuth}
        loading={authLoading}
        error={authError}
      />
    );
  }

  return (
    <main className="workspaceBrowserShell">
      <input ref={uploadRef} type="file" hidden onChange={handleUpload} />
      <WorkspaceHeader
        auth={auth}
        selectedPath={selectedPath}
        rightPanel={rightPanel}
        setRightPanel={setRightPanel}
        userMenuOpen={userMenuOpen}
        setUserMenuOpen={setUserMenuOpen}
        onOpenLauncher={() => auth.launcherUrl && window.open(auth.launcherUrl, '_blank', 'noopener,noreferrer')}
        onOpenAccountEdit={openAccountEdit}
        onLogout={handleLogout}
      />
      <FileList
        currentTree={currentTree}
        selectedPath={selectedPath}
        selectedFile={selectedFile}
        createDraft={createDraft}
        setCreateDraft={setCreateDraft}
        filter={filter}
        onFilter={setFilter}
        onOpen={handleOpenFile}
        onOpenDir={handleSelectDir}
        onRunPython={handleRunPython}
        onRename={handleRename}
        onRefresh={handleRefresh}
        onGoParent={handleGoParent}
        onNewFile={handleCreateFile}
        onNewFolder={handleCreateFolder}
        onUploadClick={() => uploadRef.current?.click()}
        onContextMenu={openContextMenu}
        contextMenu={contextMenu}
      />
      <div className="rightPanelStack">
        <div className={rightPanel === 'gemini' ? 'panelVisible' : 'panelHidden'}>
          <Suspense fallback={<div className="previewState">Gemini를 불러오는 중입니다.</div>}>
            <LazyGeminiApp
              authToken={auth.token}
              directoryPath={selectedPath}
              filePath={selectedFile}
              embedded
            />
          </Suspense>
        </div>
        <div className={rightPanel === 'rag' ? 'panelVisible' : 'panelHidden'}>
          <Suspense fallback={<div className="previewState">RAG를 불러오는 중입니다.</div>}>
            <LazyRagApp
              authToken={auth.token}
              directoryPath={selectedPath}
              filePath={selectedFile}
              title={selectedFile || selectedPath || 'workspace-rag'}
              pageTitle={selectedFile ? `RAG · ${labelForPath(selectedFile)}` : selectedPath ? `RAG · ${labelForPath(selectedPath)}` : 'Workspace RAG'}
              persistToWorkspace
              defaultQuestion={selectedFile
                ? `${labelForPath(selectedFile)} 관련 문서에서 먼저 확인할 항목은 무엇인가?`
                : 'Workspace 문서에서 먼저 확인할 항목은 무엇인가?'}
              embedded
            />
          </Suspense>
        </div>
        <div className={rightPanel === 'editor' ? 'panelVisible' : 'panelHidden'}>
          <EditorPanel
            selectedFile={selectedFile}
            content={content}
            setContent={setContent}
            loading={loadingFile}
            error={error}
            outputState={pythonOutput}
            onSave={handleSave}
            onDelete={handleDelete}
            onDownload={handleDownload}
          />
        </div>
        {auth.role === 'ADMIN' ? (
          <div className={rightPanel === 'monitor' ? 'panelVisible' : 'panelHidden'}>
            <AdminMonitorPanel activeMonitor={activeMonitor} setActiveMonitor={setActiveMonitor} />
          </div>
        ) : null}
      </div>
      <AccountEditDialog
        auth={auth}
        open={accountEditOpen}
        loading={accountEditLoading}
        error={accountEditError}
        currentPassword={currentPassword}
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        onCurrentPassword={setCurrentPassword}
        onNewPassword={setNewPassword}
        onConfirmPassword={setConfirmPassword}
        onClose={closeAccountEdit}
        onSubmit={submitAccountEdit}
      />
    </main>
  );
}
