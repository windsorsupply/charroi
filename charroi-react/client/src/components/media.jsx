// Photos (prise ou choix), aperçus avec suppression, et zone de signature.
import { useEffect, useRef } from 'react';
import { useStore } from '../store.jsx';
import { compress } from '../lib/util.js';
import { fileUrl } from '../lib/api.js';
import { Zoom } from './ui.jsx';

// Lit les fichiers choisis et retourne des photos compressées (data URL).
export async function readPhotos(input, max, size) {
  const out = [];
  for (const f of [...input.files].slice(0, max)) { const d = await compress(f, size); if (d) out.push(d); }
  input.value = '';
  return out;
}

export function EditThumbs({ list, onRemove }) {
  const { t, openModal } = useStore();
  if (!list || !list.length) return null;
  return <div className="thumbs">{list.map((p, i) => (
    <span className="thumb" key={i}>
      <img className="zoom" src={fileUrl(p)} alt={`${t('pPhoto')} ${i + 1}`} onClick={() => openModal(<Zoom src={fileUrl(p)} />)} />
      <button type="button" onClick={() => onRemove(i)} aria-label={t('removePhoto')}>✕</button>
    </span>
  ))}</div>;
}

// Encadré « Photos de la marchandise » : prendre une photo ou en choisir (8 max).
export function PhotoBox({ list, onChange, max = 8 }) {
  const { t } = useStore();
  const n = (list || []).length;
  const add = async (e) => { const ph = await readPhotos(e.target, max - n); onChange([...(list || []), ...ph].slice(0, max)); };
  return (
    <div className="photo">
      <div className="head" style={{ margin: '0 0 4px', alignItems: 'center' }}><b>📸 {t('fPhotoPkg')}</b><span className="small muted">{n}/{max}</span></div>
      <p className="small muted" style={{ margin: '0 0 10px' }}>{t('photoHelp')}</p>
      {n < max && <div className="actions" style={{ margin: 0 }}>
        <label className="btn">📷 {t('takePhoto')}<input className="vh" type="file" accept="image/*" capture="environment" onChange={add} /></label>
        <label className="btn ghost">🖼️ {t('choosePhotos')}<input className="vh" type="file" accept="image/*" multiple onChange={add} /></label>
      </div>}
      <EditThumbs list={list} onRemove={(i) => onChange(list.filter((_, j) => j !== i))} />
    </div>
  );
}

// Champ simple « Photos (4 max.) » utilisé dans les fenêtres (preuve, litige, inspection).
export function PhotoInput({ id, list, onChange, max = 4, capture }) {
  const add = async (e) => onChange([...(list || []), ...(await readPhotos(e.target, max - (list || []).length))].slice(0, max));
  return <>
    <input id={id} type="file" accept="image/*" multiple={max > 1} capture={capture ? 'environment' : undefined} onChange={add} />
    <EditThumbs list={list} onRemove={(i) => onChange(list.filter((_, j) => j !== i))} />
  </>;
}

// Signature du destinataire au doigt ; sigRef.current.get() retourne une image ou null.
export function SignaturePad({ sigRef }) {
  const { t } = useStore();
  const cv = useRef(null), dirty = useRef(false);
  const init = () => {
    const c = cv.current; if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2; c.height = r.height * 2;
    const x = c.getContext('2d');
    x.scale(2, 2); x.fillStyle = '#fff'; x.fillRect(0, 0, r.width, r.height);
    x.strokeStyle = '#1B2530'; x.lineWidth = 2.4; x.lineCap = 'round'; x.lineJoin = 'round';
    dirty.current = false;
    let down = false;
    const pos = (e) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    c.onpointerdown = (e) => { down = true; c.setPointerCapture(e.pointerId); const p = pos(e); x.beginPath(); x.moveTo(p[0], p[1]); };
    c.onpointermove = (e) => { if (!down) return; const p = pos(e); x.lineTo(p[0], p[1]); x.stroke(); dirty.current = true; };
    c.onpointerup = c.onpointercancel = () => { down = false; };
  };
  useEffect(() => { requestAnimationFrame(init); }, []);
  sigRef.current = { get: () => (dirty.current ? cv.current.toDataURL('image/jpeg', 0.6) : null) };
  return <>
    <canvas ref={cv} className="sig" />
    <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={init}>{t('pClear')}</button>
  </>;
}
