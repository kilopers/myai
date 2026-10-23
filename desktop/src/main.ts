import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Store } from '@tauri-apps/plugin-store';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';

interface Capture {
  png_base64: string;
  width: number;
  height: number;
  scale_factor: number;
}

type Tool = 'select' | 'rect' | 'arrow' | 'text' | 'blur';

interface Point { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }

type Shape =
  | { kind: 'rect'; rect: Rect; color: string }
  | { kind: 'arrow'; from: Point; to: Point; color: string }
  | { kind: 'text'; at: Point; text: string; color: string }
  | { kind: 'blur'; rect: Rect };

const STORE_KEYS = { serverUrl: 'server_url', apiToken: 'api_token' } as const;
const SHAPE_COLOR = '#ff3b30';

// ---------- settings view ----------
async function initSettings() {
  const view = document.getElementById('settings-view')!;
  view.style.display = 'block';
  const canvas = document.getElementById('canvas')!;
  canvas.style.display = 'none';

  const store = await Store.load('settings.json');
  const urlInput = document.getElementById('server-url') as HTMLInputElement;
  const tokenInput = document.getElementById('api-token') as HTMLInputElement;
  const autostartInput = document.getElementById('autostart') as HTMLInputElement;
  const status = document.getElementById('settings-status')!;

  urlInput.value = (await store.get<string>(STORE_KEYS.serverUrl)) ?? '';
  tokenInput.value = (await store.get<string>(STORE_KEYS.apiToken)) ?? '';
  autostartInput.checked = await isAutostartEnabled();

  document.getElementById('save-settings')!.addEventListener('click', async () => {
    await store.set(STORE_KEYS.serverUrl, urlInput.value.trim().replace(/\/+$/, ''));
    await store.set(STORE_KEYS.apiToken, tokenInput.value.trim());
    await store.save();
    try {
      if (autostartInput.checked) await enableAutostart();
      else await disableAutostart();
    } catch (e) {
      status.textContent = `Настройки сохранены, автозапуск: ${e}`;
      return;
    }
    status.textContent = 'Сохранено.';
    setTimeout(() => { status.textContent = ''; }, 2500);
  });
}

// ---------- overlay editor ----------
async function initOverlay() {
  const win = getCurrentWindow();
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const toolbar = document.getElementById('toolbar')!;

  const monIndex = Number(win.label.split('-')[1] ?? 0);
  const capture = await invoke<Capture | null>('take_capture', { index: monIndex });
  if (!capture) {
    await win.hide();
    return;
  }

  const img = new Image();
  img.src = `data:image/png;base64,${capture.png_base64}`;
  await img.decode();

  // Canvas in physical pixels; displayed stretched over the window.
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';

  let mode: 'selecting' | 'editing' = 'selecting';
  let tool: Tool = 'select';
  let selection: Rect | null = null;
  let shapes: Shape[] = [];
  let draft: Shape | null = null;
  let dragStart: Point | null = null;

  const toImageCoords = (e: MouseEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    };
  };

  const norm = (a: Point, b: Point): Rect => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
  });

  function drawArrow(c: CanvasRenderingContext2D, from: Point, to: Point, color: string) {
    const head = 14;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 4;
    c.beginPath();
    c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke();
    c.beginPath();
    c.moveTo(to.x, to.y);
    c.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
    c.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
    c.closePath(); c.fill();
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // Dim outside selection while selecting/editing
    if (selection) {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, canvas.width, selection.y);
      ctx.fillRect(0, selection.y + selection.h, canvas.width, canvas.height - selection.y - selection.h);
      ctx.fillRect(0, selection.y, selection.x, selection.h);
      ctx.fillRect(selection.x + selection.w, selection.y, canvas.width - selection.x - selection.w, selection.h);
      ctx.strokeStyle = '#4a6cf7'; ctx.lineWidth = 2;
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    for (const s of [...shapes, ...(draft ? [draft] : [])]) {
      switch (s.kind) {
        case 'rect':
          ctx.strokeStyle = s.color; ctx.lineWidth = 4;
          ctx.strokeRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
          break;
        case 'arrow':
          drawArrow(ctx, s.from, s.to, s.color);
          break;
        case 'text':
          ctx.fillStyle = s.color; ctx.font = 'bold 28px system-ui';
          ctx.fillText(s.text, s.at.x, s.at.y);
          break;
        case 'blur': {
          const { x, y, w, h } = s.rect;
          if (w < 2 || h < 2) break;
          const off = document.createElement('canvas');
          const factor = 0.05;
          off.width = Math.max(1, w * factor); off.height = Math.max(1, h * factor);
          const oc = off.getContext('2d')!;
          oc.drawImage(img, x, y, w, h, 0, 0, off.width, off.height);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(off, 0, 0, off.width, off.height, x, y, w, h);
          ctx.imageSmoothingEnabled = true;
          break;
        }
      }
    }
  }

  function positionToolbar() {
    if (!selection) return;
    const r = canvas.getBoundingClientRect();
    const sx = r.width / canvas.width;
    const x = r.left + selection.x * sx;
    const y = r.top + (selection.y + selection.h) * sx + 8;
    toolbar.style.display = 'flex';
    toolbar.style.left = `${Math.max(8, x)}px`;
    toolbar.style.top = `${Math.min(window.innerHeight - 60, y)}px`;
  }

  const tools: { id: Tool | 'undo' | 'upload' | 'cancel'; label: string; cls?: string }[] = [
    { id: 'select', label: 'Область' },
    { id: 'rect', label: 'Рамка' },
    { id: 'arrow', label: 'Стрелка' },
    { id: 'text', label: 'Текст' },
    { id: 'blur', label: 'Блюр' },
    { id: 'undo', label: 'Отмена' },
    { id: 'upload', label: 'Загрузить ↑', cls: 'primary' },
    { id: 'cancel', label: 'Esc', cls: 'danger' },
  ];

  toolbar.innerHTML = '';
  for (const t of tools) {
    const b = document.createElement('button');
    b.textContent = t.label;
    if (t.cls) b.className = t.cls;
    b.addEventListener('click', () => onToolClick(t.id));
    toolbar.appendChild(b);
  }

  function markActive() {
    [...toolbar.children].forEach((el, i) => {
      el.classList.toggle('active', tools[i].id === tool);
    });
  }

  async function onToolClick(id: string) {
    if (id === 'undo') { shapes.pop(); render(); return; }
    if (id === 'cancel') { await invoke('close_overlays'); return; }
    if (id === 'upload') { await doUpload(); return; }
    tool = id as Tool;
    mode = id === 'select' ? 'selecting' : 'editing';
    markActive();
  }

  canvas.addEventListener('mousedown', (e) => {
    const p = toImageCoords(e);
    if (mode === 'selecting') {
      dragStart = p;
      selection = null;
    } else if (tool === 'rect' || tool === 'blur' || tool === 'arrow') {
      dragStart = p;
    } else if (tool === 'text') {
      const text = prompt('Текст:');
      if (text) { shapes.push({ kind: 'text', at: p, text, color: SHAPE_COLOR }); render(); }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const p = toImageCoords(e);
    if (mode === 'selecting') {
      selection = norm(dragStart, p);
    } else if (tool === 'rect') {
      draft = { kind: 'rect', rect: norm(dragStart, p), color: SHAPE_COLOR };
    } else if (tool === 'blur') {
      draft = { kind: 'blur', rect: norm(dragStart, p) };
    } else if (tool === 'arrow') {
      draft = { kind: 'arrow', from: dragStart, to: p, color: SHAPE_COLOR };
    }
    render();
    positionToolbar();
  });

  canvas.addEventListener('mouseup', () => {
    if (!dragStart) return;
    dragStart = null;
    if (mode === 'selecting') {
      if (selection && selection.w > 4 && selection.h > 4) {
        tool = 'rect';
        mode = 'editing';
        markActive();
        positionToolbar();
      } else {
        selection = null;
      }
    } else if (draft) {
      shapes.push(draft);
      draft = null;
    }
    render();
  });

  window.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') await invoke('close_overlays');
    if (e.ctrlKey && e.key === 'z') { shapes.pop(); render(); }
  });

  async function doUpload() {
    if (!selection) return;
    render();

    const out = document.createElement('canvas');
    out.width = Math.round(selection.w);
    out.height = Math.round(selection.h);
    out.getContext('2d')!.drawImage(
      canvas,
      selection.x, selection.y, selection.w, selection.h,
      0, 0, out.width, out.height,
    );
    const dataUrl = out.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];

    const store = await Store.load('settings.json');
    const serverUrl = await store.get<string>(STORE_KEYS.serverUrl);
    const token = await store.get<string>(STORE_KEYS.apiToken);
    if (!serverUrl || !token) {
      alert('Не настроен сервер или токен. Открой настройки из трея.');
      return;
    }

    try {
      const url = await invoke<string>('upload_screenshot', {
        serverUrl, token, pngBase64: base64,
      });
      await writeText(url);
      if (!(await isPermissionGranted())) await requestPermission();
      await sendNotification({ title: 'Screenshoter', body: 'Ссылка скопирована в буфер обмена' });
      await invoke('close_overlays');
    } catch (err) {
      alert(`Ошибка загрузки: ${err}`);
    }
  }

  render();
}

// ---------- entry ----------
if (location.hash === '#settings' || location.search.includes('view=settings')) {
  initSettings();
} else {
  initOverlay();
}
