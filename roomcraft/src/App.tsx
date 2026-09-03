import React, { useState, useEffect, useMemo, useRef } from 'react';

import deskImg from '../assets/desk2_cutout.webp';
import chairImg from '../assets/chair_cutout.webp';
import lampImg from '../assets/lamp_cutout.webp';
import shelfImg from '../assets/shelf_cutout.webp';
import shelf2Img from '../assets/shelf2_cutout.webp';

type ProductImage = {
  src: string;
  label: string;
  grain: number;
};

type Product = {
  title: string;
  price: number;
  originalPrice: number;
  platform: string;
  images: ProductImage[];
  affiliate: string;
  originalLink: string;
};

type QueueStatus = 'Imported' | 'Video Done' | 'Posted';

type QueueItem = {
  id: number;
  title: string;
  platform: string;
  status: QueueStatus;
  date: string;
  views: string;
  channels: string[];
};

const PRODUCT_IMAGES: ProductImage[] = [
  { src: deskImg, label: '원목 데스크 800', grain: 94 },
  { src: chairImg, label: '접이식 체어', grain: 92 },
  { src: lampImg, label: '펜던트 조명', grain: 90 },
];

const ROOM_ITEMS = [
  { src: lampImg, name: '펜던트 조명', style: { left: '37%', top: '-1%', width: '10%' } },
  { src: shelfImg, name: '3단 오픈 선반', style: { left: '1%', bottom: '9%', width: '27%' } },
  { src: deskImg, name: '원목 데스크 800', style: { left: '28%', bottom: '8%', width: '45%' } },
  { src: shelf2Img, name: '박스 선반 600', style: { right: '1%', bottom: '9%', width: '25%' } },
  { src: chairImg, name: '접이식 체어', style: { left: '50%', bottom: '2%', width: '18%' } },
];

// The figures a furniture catalogue would print, and the ones the script quotes.
const SPECS = [
  { k: '상판', v: '800 × 500 mm' },
  { k: '접은 두께', v: '90 mm' },
  { k: '내하중', v: '80 kg' },
  { k: '재질', v: '오크 원목' },
];

const RENDER_SLATE = '1080 × 1920 · H.264 · 12s · 30fps';

const LOGS_BASE = [
  '플랫폼 감지: {PLATFORM}',
  '이미지 분석: 원목 질감 94%',
  '가격 분석: 경쟁력 92%',
  'SEO 키워드: 원룸 책상 (12K)',
  '스크립트 생성 완료',
];

const TEMPLATES = [
  { id: 'A', name: '가격비교', desc: '정가 대비 할인율' },
  { id: 'B', name: '조립타임랩스', desc: '10초 조립, 원룸 변신' },
  { id: 'C', name: '스펙강조', desc: '원목·내하중·접이식' },
];

const MOCK_QUEUE: QueueItem[] = [
  {
    id: 1,
    title: 'ROOMCRAFT 접이식 선반 600',
    platform: 'Coupang',
    status: 'Posted',
    date: '11.21 14:30',
    views: '18.2K',
    channels: ['Instagram Reels', 'YouTube Shorts', 'TikTok'],
  },
  {
    id: 2,
    title: '원목 접이식 데스크 800',
    platform: 'Amazon',
    status: 'Video Done',
    date: '11.21 13:10',
    views: '—',
    channels: ['Instagram Reels', 'YouTube Shorts'],
  },
  {
    id: 3,
    title: '미니 폴딩 테이블',
    platform: 'AliExpress',
    status: 'Imported',
    date: '11.21 11:05',
    views: '—',
    channels: [],
  },
];

const CHANNELS = [
  { key: 'insta' as const, name: 'Instagram Reels', sub: '9:16 · 자막 자동', count: '12.4K' },
  { key: 'youtube' as const, name: 'YouTube Shorts', sub: '쇼츠 알고리즘 최적화', count: '8.2K' },
  { key: 'tiktok' as const, name: 'TikTok', sub: '원룸·자취 해시태그', count: '21K' },
  { key: 'pinterest' as const, name: 'Pinterest', sub: '아이디어 핀 고정', count: '3.1K' },
];

const EXAMPLE_LINKS = [
  'https://www.coupang.com/vp/products/123',
  'https://www.amazon.com/dp/B0XXXX',
  'https://www.aliexpress.com/item/100500',
];

const STATUS_KO: Record<QueueStatus, string> = {
  Imported: '가져옴',
  'Video Done': '영상완료',
  Posted: '발행완료',
};

const STATUS_TONE: Record<QueueStatus, string> = {
  Imported: 'text-muted',
  'Video Done': 'text-wait',
  Posted: 'text-go',
};

const STEPS = [
  { k: 0, no: '01', label: 'IMPORT', sub: '제품 가져오기' },
  { k: 1, no: '02', label: 'STUDIO', sub: '영상 스튜디오' },
  { k: 2, no: '03', label: 'PUBLISH', sub: 'SNS 발행' },
];

const won = (n: number) => `₩${Math.max(0, Math.round(n)).toLocaleString('ko-KR')}`;

// The demo product the page opens with, so the first frame shows the tool working.
const SAMPLE_LINK = EXAMPLE_LINKS[0];
const SAMPLE_PRODUCT: Product = {
  title: 'ROOMCRAFT 원목 접이식 데스크 800',
  price: 39000,
  originalPrice: 59000,
  platform: 'Coupang',
  images: PRODUCT_IMAGES,
  affiliate: SAMPLE_LINK,
  originalLink: SAMPLE_LINK,
};

const RoomScene = ({ compact }: { compact?: boolean }) => (
  <div
    className="relative w-full overflow-hidden"
    style={{ aspectRatio: '4/3', background: 'linear-gradient(#EAE6DE 0%, #E6E1D8 62%, #D8D0C3 62%, #D2C9BA 100%)' }}
  >
    <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(110% 75% at 42% 18%, rgba(255,255,255,0.5), transparent 62%)' }} />
    {ROOM_ITEMS.map(item => (
      <img
        key={item.name}
        src={item.src}
        alt={item.name}
        className="absolute select-none"
        style={{ ...item.style, filter: 'drop-shadow(0 10px 12px rgba(40,30,16,0.18))' }}
      />
    ))}
    {compact && (
      <div className="absolute left-0 top-0 bg-ink px-2.5 py-1 font-mono text-[10px] tracking-label text-plate">
        {ROOM_ITEMS.length} ITEMS
      </div>
    )}
  </div>
);

export default function App() {
  // Tabs
  const [activeTab, setActiveTab] = useState<number>(0);

  // IMPORT
  const [linkInput, setLinkInput] = useState<string>(SAMPLE_LINK);
  const [product, setProduct] = useState<Product | null>(SAMPLE_PRODUCT);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [aiLogs, setAiLogs] = useState<string[]>(LOGS_BASE.map(l => l.replace('{PLATFORM}', SAMPLE_PRODUCT.platform)));
  const [editTitle, setEditTitle] = useState<string>(SAMPLE_PRODUCT.title);
  const [editPrice, setEditPrice] = useState<string>(String(SAMPLE_PRODUCT.price));
  const aiIntervalRef = useRef<number | null>(null);

  // STUDIO
  const [templateIdx, setTemplateIdx] = useState<number>(0);
  const [scriptText, setScriptText] = useState<string>('');
  const [scriptEdited, setScriptEdited] = useState<boolean>(false);
  const [videoProgress, setVideoProgress] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [videoDone, setVideoDone] = useState<boolean>(false);
  const videoIntervalRef = useRef<number | null>(null);

  // PUBLISH
  const [sns, setSns] = useState({ insta: true, youtube: true, tiktok: false, pinterest: false });
  const [caption, setCaption] = useState<string>('');
  const [captionEdited, setCaptionEdited] = useState<boolean>(false);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduleDate, setScheduleDate] = useState<string>('');
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [queueDetail, setQueueDetail] = useState<QueueItem | null>(null);
  const [queue] = useState<QueueItem[]>(MOCK_QUEUE);

  // UI
  const [toast, setToast] = useState<string>('');
  const [showRoom, setShowRoom] = useState<boolean>(false);
  const toastTimerRef = useRef<number | null>(null);

  // Live values: what the user typed always wins over what the analyzer returned.
  const liveTitle = editTitle || product?.title || '';
  const livePrice = editPrice ? parseInt(editPrice, 10) || 0 : product?.price ?? 0;
  const originalPrice = product?.originalPrice ?? 0;
  const saved = Math.max(0, originalPrice - livePrice);
  const discount = originalPrice > 0 && livePrice > 0 ? Math.max(0, Math.round((1 - livePrice / originalPrice) * 100)) : 0;

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2400);
  };

  // Helpers
  const detectPlatform = (url: string): string => {
    const u = (url || '').toLowerCase();
    if (u.includes('coupang')) return 'Coupang';
    if (u.includes('amazon')) return 'Amazon';
    if (u.includes('aliexpress')) return 'AliExpress';
    if (u.includes('ebay')) return 'eBay';
    return 'Unknown';
  };

  const makeAffiliate = (url: string): string => {
    // Demo build: keep the original URL so the buy button opens a page that exists.
    // In production swap this for the Coupang Partners / Amazon Associates converted link.
    return url || '';
  };

  const openBuyLink = () => {
    const target = product?.affiliate || product?.originalLink;
    if (!target) return;
    window.open(target, '_blank', 'noopener,noreferrer');
    showToast('구매 페이지를 새 탭에서 열었습니다');
  };

  const makeScript = (title: string, price: number, orig: number, off: number, tIdx: number): string => {
    const tpl = TEMPLATES[tIdx] ?? TEMPLATES[0];
    if (tpl.id === 'A') {
      return `이 가격 실화?\n\n${title}\n정가 ${won(orig)} → 지금 ${won(price)}\n${off}% 할인, 오늘만.\n\n원룸에 딱 800mm, 접으면 90mm.\n링크는 프로필에.`;
    }
    if (tpl.id === 'B') {
      return `자취생 필수템 조립 타임랩스\n\n${title}\n개봉부터 완성까지 10초.\n공구 필요 없음. 접고 펴면 끝.\n\n자취 3년차가 인정한 내구성.\n프로필 링크에서 ${won(price)} 확인.`;
    }
    return `원목이라 다른데?\n\n${title}\n프리미엄 원목, 내하중 80kg.\n생활방수 코팅, 접이식 힌지 3단 고정.\n\n좁은 원룸 넓게 쓰는 법 — ${won(price)}\nROOMCRAFT.WORLD`;
  };

  const makeCaption = (title: string, price: number, off: number): string =>
    `${title} - 원룸 끝판왕\n\n${won(price)}부터 (${off}% OFF)\n접이식이라 이사할 때도 그대로.\n\n#원룸인테리어 #접이식책상 #자취방꾸미기 #원목책상 #룸크래프트 #roomcraft #1인가구 #자취템 #데스크셋업\n\n🔗 프로필 링크에서 최저가 확인`;

  // IMPORT action
  const handleAnalyze = () => {
    const trimmed = linkInput.trim();
    if (!trimmed || isAnalyzing) return;

    setIsAnalyzing(true);
    setAiLogs([]);
    setProduct(null);
    setVideoDone(false);
    setVideoProgress(0);
    setScriptEdited(false);
    setCaptionEdited(false);

    const platform = detectPlatform(trimmed);
    const logs = LOGS_BASE.map(l => l.replace('{PLATFORM}', platform));

    let logIndex = 0;
    if (aiIntervalRef.current) window.clearInterval(aiIntervalRef.current);
    aiIntervalRef.current = window.setInterval(() => {
      if (logIndex < logs.length) {
        // Read the line before advancing: React runs the updater later, so a
        // closure over logIndex would append the *next* line instead.
        const line = logs[logIndex];
        logIndex += 1;
        setAiLogs(prev => [...prev, line]);
        return;
      }
      if (aiIntervalRef.current) {
        window.clearInterval(aiIntervalRef.current);
        aiIntervalRef.current = null;
      }
      const found: Product = {
        title: 'ROOMCRAFT 원목 접이식 데스크 800',
        price: 39000,
        originalPrice: 59000,
        platform,
        images: PRODUCT_IMAGES,
        affiliate: makeAffiliate(trimmed),
        originalLink: trimmed,
      };
      const off = Math.round((1 - found.price / found.originalPrice) * 100);
      setProduct(found);
      setEditTitle(found.title);
      setEditPrice(String(found.price));
      setScriptText(makeScript(found.title, found.price, found.originalPrice, off, templateIdx));
      setCaption(makeCaption(found.title, found.price, off));
      setIsAnalyzing(false);
    }, 400);
  };

  // STUDIO action
  const handleGenerate = () => {
    if (!product || isGenerating) return;
    setIsGenerating(true);
    setVideoProgress(0);
    setVideoDone(false);

    if (videoIntervalRef.current) window.clearInterval(videoIntervalRef.current);
    let prog = 0;
    videoIntervalRef.current = window.setInterval(() => {
      prog += Math.floor(Math.random() * 9) + 6;
      if (prog < 100) {
        setVideoProgress(prog);
        return;
      }
      setVideoProgress(100);
      if (videoIntervalRef.current) {
        window.clearInterval(videoIntervalRef.current);
        videoIntervalRef.current = null;
      }
      setIsGenerating(false);
      setVideoDone(true);
    }, 180);
  };

  const handlePublish = () => {
    if (selectedCount === 0 || !product) return;
    setShowSuccess(true);
  };

  // Keep the generated copy in sync with edits, unless the user rewrote it by hand.
  useEffect(() => {
    if (!product) return;
    if (!scriptEdited) setScriptText(makeScript(liveTitle, livePrice, originalPrice, discount, templateIdx));
    if (!captionEdited) setCaption(makeCaption(liveTitle, livePrice, discount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTitle, livePrice, discount, templateIdx, product]);

  // Clear every timer on unmount.
  useEffect(() => {
    return () => {
      if (aiIntervalRef.current) window.clearInterval(aiIntervalRef.current);
      if (videoIntervalRef.current) window.clearInterval(videoIntervalRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Esc closes whichever overlay is on top.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showSuccess) return setShowSuccess(false);
      if (queueDetail) return setQueueDetail(null);
      if (showRoom) return setShowRoom(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSuccess, queueDetail, showRoom]);

  const selectedCount = useMemo(() => Object.values(sns).filter(Boolean).length, [sns]);
  const selectedChannels = CHANNELS.filter(c => sns[c.key]);

  const stepState = (k: number) => {
    if (k === 0) return product ? '완료' : '대기';
    if (k === 1) return videoDone ? '완료' : isGenerating ? `${videoProgress}%` : '대기';
    return selectedCount > 0 ? `${selectedCount} 채널` : '대기';
  };

  const btnPrimary =
    'inline-flex items-center justify-center gap-2 bg-ink px-5 py-3 text-[13px] font-bold text-plate transition hover:bg-black disabled:bg-rule disabled:text-muted';
  const btnGhost =
    'inline-flex items-center justify-center gap-2 border border-rule px-5 py-3 text-[13px] font-semibold transition hover:border-ink';
  const field =
    'w-full border-b border-rule bg-transparent py-2.5 text-[15px] outline-none transition focus:border-ink';

  return (
    <div className="min-h-screen w-full bg-paper text-ink antialiased">
      {/* Masthead */}
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/92 backdrop-blur">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-4 px-5 py-3.5 md:px-8">
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-[16px] font-bold tracking-tight">ROOMCRAFT</span>
            <span className="hidden font-mono text-[10px] tracking-label text-muted sm:inline">AUTO FACTORY V3</span>
          </div>
          <div className="flex items-center gap-5 font-mono text-[10px] tracking-label text-muted">
            <span className="hidden sm:inline">
              LOGS <span className="tabular-nums text-ink">{String(aiLogs.length).padStart(2, '0')}/05</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-go" />
              ENGINE LIVE
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1360px] grid-cols-1 md:grid-cols-[188px_1fr] lg:grid-cols-[188px_1fr_296px]">
        {/* Step ledger. The numbering is honest — this really is a sequence. */}
        <nav className="hidden border-r border-rule md:sticky md:top-[53px] md:block md:h-[calc(100vh-53px)] md:py-7">
          {STEPS.map(step => {
            const on = activeTab === step.k;
            return (
              <button
                key={step.k}
                type="button"
                onClick={() => setActiveTab(step.k)}
                aria-current={on ? 'step' : undefined}
                className={`group flex w-full items-start gap-3 border-l-2 py-3.5 pl-5 pr-4 text-left transition ${
                  on ? 'border-oak bg-plate' : 'border-transparent hover:bg-plate/60'
                }`}
              >
                <span className={`mt-0.5 font-mono text-[10px] tabular-nums ${on ? 'text-oak' : 'text-muted'}`}>{step.no}</span>
                <span className="flex-1">
                  <span className={`block text-[12px] font-bold tracking-label ${on ? '' : 'text-muted'}`}>{step.label}</span>
                  <span className="mt-0.5 block text-[12px] text-muted">{step.sub}</span>
                </span>
                <span className={`mt-0.5 font-mono text-[10px] tabular-nums ${stepState(step.k) === '완료' ? 'text-go' : 'text-muted'}`}>
                  {stepState(step.k) === '완료' ? '✓' : ''}
                </span>
              </button>
            );
          })}

          {product && (
            <div className="mt-8 px-5">
              <div className="eyebrow">현재 제품</div>
              <div className="mt-3 flex h-[72px] items-end justify-center bg-plate">
                <img src={product.images[0].src} alt="" className="max-h-full w-auto object-contain" />
              </div>
              <div className="mt-3 font-serif text-[13px] font-bold leading-snug">{liveTitle}</div>
              <div className="mt-1 font-mono text-[11px] tabular-nums text-muted">
                {product.platform} · {won(livePrice)}
              </div>
            </div>
          )}
        </nav>

        {/* Sheet */}
        <main className="min-h-[calc(100vh-53px)] px-5 pb-28 pt-8 md:px-9 md:pb-16 lg:border-r lg:border-rule">
          {/* ── IMPORT ── */}
          {activeTab === 0 && (
            <div className="mx-auto max-w-[640px]">
              <h1 className="font-serif text-[30px] font-bold leading-[1.25] tracking-tight">
                링크 하나면<br />나머지는 공장이 합니다.
              </h1>
              <p className="mt-3 max-w-[52ch] text-[14px] text-muted">
                쿠팡·아마존·알리익스프레스·이베이 상품 페이지를 읽어 제목, 가격, SEO 키워드, 촬영 스크립트까지 만들어 둡니다.
              </p>

              <section className="sheet mt-8">
                <div className="eyebrow-en">Product link</div>
                <form
                  className="mt-2 flex items-end gap-3"
                  onSubmit={e => {
                    e.preventDefault();
                    handleAnalyze();
                  }}
                >
                  <input
                    id="product-link-input"
                    value={linkInput}
                    onChange={e => setLinkInput(e.target.value)}
                    placeholder="상품 페이지 주소를 붙여넣으세요"
                    className={`${field} font-mono text-[13px]`}
                  />
                  <button type="submit" disabled={isAnalyzing || !linkInput.trim()} className={`${btnPrimary} shrink-0 whitespace-nowrap`}>
                    {isAnalyzing ? '분석 중' : '분석'}
                  </button>
                </form>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px]">
                  <span className="text-muted">예시</span>
                  {EXAMPLE_LINKS.map(ex => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => {
                        setLinkInput(ex);
                        showToast(`예시 적용: ${ex.replace('https://www.', '')}`);
                      }}
                      className={`underline-offset-4 transition hover:text-ink hover:underline ${linkInput === ex ? 'text-oak underline' : 'text-muted'}`}
                    >
                      {ex.replace('https://www.', '')}
                    </button>
                  ))}
                </div>
              </section>

              {(aiLogs.length > 0 || isAnalyzing) && (
                <section className="mt-6 bg-ink px-5 py-4 text-plate">
                  <div className="font-mono text-[10px] uppercase tracking-label text-plate/45">Engine log</div>
                  <ol className="mt-3 space-y-1.5 font-mono text-[12px]">
                    {aiLogs.map((log, i) => (
                      <li key={`log-${i}`} className="flex gap-4" style={{ animation: 'riseIn 220ms ease-out' }}>
                        <span className="tabular-nums text-plate/35">{String(i + 1).padStart(2, '0')}</span>
                        <span>{log}</span>
                      </li>
                    ))}
                    {isAnalyzing && (
                      <li className="flex gap-4 text-plate/50">
                        <span className="tabular-nums text-plate/35">{String(aiLogs.length + 1).padStart(2, '0')}</span>
                        <span>처리 중…</span>
                      </li>
                    )}
                  </ol>
                </section>
              )}

              {product ? (
                <>
                  {/* Product sheet */}
                  <section className="sheet mt-10">
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="eyebrow">{product.platform} · 감지됨</div>
                      <div className="font-mono text-[11px] tabular-nums text-muted">IMG 3 · SPEC 4</div>
                    </div>

                    <h2 className="mt-3 font-serif text-[22px] font-bold leading-snug">{liveTitle}</h2>

                    <div className="mt-3 flex items-baseline gap-3">
                      <span className="text-[26px] font-bold tabular-nums">{won(livePrice)}</span>
                      <span className="font-mono text-[12px] tabular-nums text-muted line-through">{won(originalPrice)}</span>
                      {discount > 0 && (
                        <span className="font-mono text-[12px] tabular-nums text-go">
                          −{discount}% · {won(saved)} 절약
                        </span>
                      )}
                    </div>

                    <div className="mt-6 grid grid-cols-3 gap-px bg-rule">
                      {product.images.map((img, idx) => (
                        <figure key={img.label} className="group relative bg-plate" style={{ aspectRatio: '4/3' }}>
                          <img src={img.src} alt={img.label} className="absolute inset-0 h-full w-full object-contain p-4 transition duration-500 group-hover:scale-[1.06]" />
                          <figcaption className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1.5 font-mono text-[10px] text-muted">
                            <span className="tabular-nums">{String(idx + 1).padStart(2, '0')}</span>
                            <span className="tabular-nums opacity-0 transition group-hover:opacity-100">질감 {img.grain}%</span>
                          </figcaption>
                        </figure>
                      ))}
                    </div>

                    {/* The measured figures the script quotes — printed like a catalogue. */}
                    <dl className="mt-6 grid grid-cols-2 gap-x-8 sm:grid-cols-4">
                      {SPECS.map(s => (
                        <div key={s.k} className="border-t border-rule py-2.5">
                          <dt className="font-mono text-[10px] uppercase tracking-label text-muted">{s.k}</dt>
                          <dd className="mt-0.5 font-mono text-[13px] tabular-nums">{s.v}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  {/* Editable fields */}
                  <section className="sheet mt-10">
                    <div className="eyebrow">편집</div>
                    <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-[1fr_180px]">
                      <label className="block">
                        <span className="font-mono text-[10px] uppercase tracking-label text-muted">제품명</span>
                        <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className={field} />
                      </label>
                      <label className="block">
                        <span className="font-mono text-[10px] uppercase tracking-label text-muted">판매가</span>
                        <input
                          id="edit-price"
                          value={editPrice}
                          onChange={e => setEditPrice(e.target.value.replace(/[^0-9]/g, ''))}
                          inputMode="numeric"
                          className={`${field} font-mono tabular-nums`}
                        />
                      </label>
                    </div>
                    <p className="mt-2.5 text-[12px] text-muted">고치는 즉시 스크립트·캡션·할인율·미리보기에 반영됩니다.</p>
                  </section>

                  {/* Affiliate */}
                  <section className="sheet mt-10">
                    <div className="eyebrow">제휴 링크</div>
                    <div className="mt-3 space-y-1.5 font-mono text-[12px]">
                      <div className="truncate text-muted">{product.originalLink}</div>
                      <div className="truncate">
                        <span className="text-oak">↳ </span>
                        {product.affiliate}
                      </div>
                    </div>
                    <div className="mt-6 flex flex-wrap gap-3">
                      <button type="button" onClick={openBuyLink} className={btnGhost}>
                        구매 페이지 열기 ↗
                      </button>
                      <button type="button" onClick={() => setActiveTab(1)} className={btnPrimary}>
                        스튜디오로 →
                      </button>
                    </div>
                  </section>

                  {/* Room preview */}
                  <section className="sheet mt-10">
                    <button type="button" onClick={() => setShowRoom(true)} className="group block w-full text-left">
                      <div className="flex items-baseline justify-between">
                        <span className="eyebrow">룸 프리뷰</span>
                        <span className="font-mono text-[11px] text-muted transition group-hover:text-ink">크게 보기 →</span>
                      </div>
                      <div className="mt-3 border border-rule transition group-hover:border-ink">
                        <RoomScene compact />
                      </div>
                      <p className="mt-2.5 text-[12px] text-muted">이 제품을 포함한 원룸 구성 {ROOM_ITEMS.length}점.</p>
                    </button>
                  </section>
                </>
              ) : (
                !isAnalyzing && (
                  <section className="sheet mt-10">
                    <p className="py-8 text-center text-[13px] text-muted">
                      분석된 제품이 없습니다. 링크를 붙여넣고 분석을 누르세요.
                    </p>
                  </section>
                )
              )}
            </div>
          )}

          {/* ── STUDIO ── */}
          {activeTab === 1 && (
            <div className="mx-auto max-w-[900px]">
              {!product ? (
                <div className="border-t border-rule py-16 text-center">
                  <p className="text-[14px] font-bold">먼저 제품을 가져오세요</p>
                  <p className="mt-2 text-[13px] text-muted">IMPORT에서 링크를 분석하면 스튜디오가 열립니다.</p>
                  <button type="button" onClick={() => setActiveTab(0)} className={`${btnGhost} mt-6`}>
                    IMPORT로
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_300px]">
                  <div>
                    <h2 className="font-serif text-[24px] font-bold tracking-tight">영상 스튜디오</h2>

                    <section className="sheet mt-7">
                      <div className="eyebrow">템플릿</div>
                      <div className="mt-3 grid grid-cols-1 gap-px bg-rule sm:grid-cols-3">
                        {TEMPLATES.map((t, idx) => {
                          const on = templateIdx === idx;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                setTemplateIdx(idx);
                                setScriptEdited(false);
                                setScriptText(makeScript(liveTitle, livePrice, originalPrice, discount, idx));
                                setVideoDone(false);
                                setVideoProgress(0);
                              }}
                              className={`p-4 text-left transition ${on ? 'bg-ink text-plate' : 'bg-plate hover:bg-paper'}`}
                            >
                              <div className={`font-mono text-[10px] tabular-nums ${on ? 'text-plate/50' : 'text-muted'}`}>{t.id}</div>
                              <div className="mt-1.5 text-[13px] font-bold">{t.name}</div>
                              <div className={`mt-0.5 text-[12px] ${on ? 'text-plate/60' : 'text-muted'}`}>{t.desc}</div>
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    <section className="sheet mt-8">
                      <div className="flex items-baseline justify-between">
                        <span className="eyebrow">
                          스크립트{scriptEdited && <span className="ml-2 normal-case tracking-normal text-oak">직접 수정됨</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setScriptEdited(false);
                            setScriptText(makeScript(liveTitle, livePrice, originalPrice, discount, templateIdx));
                            showToast('스크립트를 현재 제품 정보로 다시 생성했습니다');
                          }}
                          className="font-mono text-[11px] text-muted underline-offset-4 transition hover:text-ink hover:underline"
                        >
                          다시 생성
                        </button>
                      </div>
                      <textarea
                        value={scriptText}
                        onChange={e => {
                          setScriptText(e.target.value);
                          setScriptEdited(true);
                        }}
                        className="mt-3 min-h-[248px] w-full resize-none bg-plate p-5 text-[14px] leading-[1.75] outline-none ring-1 ring-inset ring-rule transition focus:ring-ink"
                      />
                      <div className="mt-2 text-right font-mono text-[11px] tabular-nums text-muted">
                        {scriptText.length}자
                      </div>
                    </section>

                    <section className="mt-8">
                      <button type="button" onClick={handleGenerate} disabled={isGenerating} className={`${btnPrimary} w-full py-4`}>
                        {isGenerating ? (
                          <span className="tabular-nums">렌더링 {videoProgress}%</span>
                        ) : videoDone ? (
                          '다시 생성'
                        ) : (
                          '영상 생성'
                        )}
                      </button>

                      {(isGenerating || videoDone) && (
                        <div className="mt-3">
                          <div className="h-px w-full bg-rule">
                            <div
                              className={`h-px transition-all duration-300 ${videoDone ? 'bg-go' : 'bg-ink'}`}
                              style={{ width: `${videoProgress}%` }}
                            />
                          </div>
                          <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums">
                            <span className={videoDone ? 'text-go' : 'text-muted'}>{videoDone ? '렌더링 완료' : 'FFmpeg 렌더링 중'}</span>
                            <span className="text-muted">{videoProgress}%</span>
                          </div>
                        </div>
                      )}
                    </section>
                  </div>

                  {/* The one thing on the page that earns real elevation. */}
                  <aside className="lg:sticky lg:top-[77px] lg:h-fit">
                    <div className="flex items-baseline justify-between">
                      <span className="eyebrow">미리보기 · 9:16</span>
                      <span className={`font-mono text-[10px] tracking-label ${videoDone ? 'text-go' : 'text-muted'}`}>{videoDone ? 'DONE' : 'DRAFT'}</span>
                    </div>

                    <div
                      className="relative mx-auto mt-3 w-full max-w-[286px] overflow-hidden rounded-[22px] bg-[#131210]"
                      style={{ aspectRatio: '9/16', boxShadow: '0 26px 50px -18px rgba(25,23,19,0.5), 0 2px 8px rgba(25,23,19,0.18)' }}
                    >
                      <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/75 to-transparent px-4 pb-8 pt-4">
                        <div className="font-serif text-[13px] font-bold leading-tight text-white">{liveTitle}</div>
                        <div className="mt-1 font-mono text-[9px] tracking-label text-white/50">{TEMPLATES[templateIdx].name}</div>
                      </div>

                      <div className="absolute inset-0 flex flex-col justify-center gap-2 px-3 pb-[128px] pt-20">
                        <div className="overflow-hidden">
                          <div className="flex gap-2" style={{ animation: 'slideX 7s ease-in-out infinite' }}>
                            {[...product.images, ...product.images].map((img, i) => (
                              <div key={`slide-${i}`} className="relative h-[164px] w-[178px] shrink-0 bg-white/[0.06]">
                                <img src={img.src} alt="" className="absolute inset-0 h-full w-full object-contain p-3" />
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {product.images.map(img => (
                            <div key={`mini-${img.label}`} className="flex h-9 items-center justify-center bg-white/[0.06]">
                              <img src={img.src} alt="" className="h-full w-auto object-contain p-1" />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="absolute inset-x-3 bottom-11 z-10 bg-plate p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-mono text-[9px] uppercase tracking-label text-muted">Today only</div>
                            <div className="text-[16px] font-bold tabular-nums">{won(livePrice)}</div>
                          </div>
                          <button type="button" onClick={openBuyLink} className="bg-ink px-3 py-2 text-[11px] font-bold text-plate transition hover:bg-black">
                            구매하기
                          </button>
                        </div>
                        <div className="mt-2 h-px w-full bg-rule">
                          <div className="h-px bg-oak" style={{ width: `${Math.min(100, discount)}%` }} />
                        </div>
                      </div>

                      <div className="absolute inset-x-0 bottom-3 z-10 text-center font-mono text-[9px] tracking-label text-white/45">
                        ROOMCRAFT.WORLD
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button type="button" onClick={() => setActiveTab(2)} disabled={!videoDone} className={`${btnPrimary} flex-1 py-2.5`}>
                        발행 단계로 →
                      </button>
                      <button type="button" onClick={() => showToast('초안을 저장했습니다')} className={`${btnGhost} py-2.5`}>
                        저장
                      </button>
                    </div>
                    <div className="mt-3 text-center font-mono text-[10px] tabular-nums text-muted">{RENDER_SLATE}</div>
                  </aside>
                </div>
              )}
            </div>
          )}

          {/* ── PUBLISH ── */}
          {activeTab === 2 && (
            <div className="mx-auto max-w-[640px]">
              <h2 className="font-serif text-[24px] font-bold tracking-tight">SNS 발행</h2>
              <p className="mt-2 max-w-[52ch] text-[14px] text-muted">선택한 채널에 동시 발행합니다. 해시태그는 채널별로 자동 조정됩니다.</p>

              {!product ? (
                <div className="mt-8 border-t border-rule py-16 text-center">
                  <p className="text-[13px] text-muted">IMPORT → STUDIO를 마치면 발행할 수 있습니다.</p>
                </div>
              ) : (
                <>
                  <section className="sheet mt-8">
                    <div className="eyebrow">채널</div>
                    <div className="mt-2">
                      {CHANNELS.map(ch => (
                        <label
                          key={ch.key}
                          className="flex cursor-pointer items-center gap-4 border-b border-rule py-3.5 transition hover:bg-plate"
                        >
                          <input
                            type="checkbox"
                            checked={sns[ch.key]}
                            onChange={e => setSns(prev => ({ ...prev, [ch.key]: e.target.checked }))}
                            className="h-3.5 w-3.5 shrink-0 accent-ink"
                          />
                          <span className="flex-1">
                            <span className="block text-[13px] font-bold">{ch.name}</span>
                            <span className="block text-[12px] text-muted">{ch.sub}</span>
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-muted">{ch.count}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className="sheet mt-8">
                    <div className="flex items-baseline justify-between">
                      <span className="eyebrow">
                        캡션{captionEdited && <span className="ml-2 normal-case tracking-normal text-oak">직접 수정됨</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setCaptionEdited(false);
                          setCaption(makeCaption(liveTitle, livePrice, discount));
                          showToast('캡션을 다시 생성했습니다');
                        }}
                        className="font-mono text-[11px] text-muted underline-offset-4 transition hover:text-ink hover:underline"
                      >
                        다시 생성
                      </button>
                    </div>
                    <textarea
                      value={caption}
                      onChange={e => {
                        setCaption(e.target.value);
                        setCaptionEdited(true);
                      }}
                      className="mt-3 min-h-[168px] w-full resize-none bg-plate p-5 text-[13px] leading-[1.7] outline-none ring-1 ring-inset ring-rule transition focus:ring-ink"
                    />
                    <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-muted">
                      <span>{selectedCount}개 채널</span>
                      <span>{caption.length}자</span>
                    </div>
                  </section>

                  <section className="sheet mt-8">
                    <div className="flex items-baseline justify-between">
                      <span className="eyebrow">발행 시점</span>
                      <div className="flex gap-4 font-mono text-[11px]">
                        {(['now', 'later'] as const).map(mode => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setScheduleMode(mode)}
                            className={`underline-offset-4 transition ${scheduleMode === mode ? 'text-ink underline' : 'text-muted hover:text-ink'}`}
                          >
                            {mode === 'now' ? '즉시' : '예약'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {scheduleMode === 'later' && (
                      <input
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={e => setScheduleDate(e.target.value)}
                        className={`${field} mt-2 font-mono text-[13px]`}
                      />
                    )}
                    <button type="button" onClick={handlePublish} disabled={selectedCount === 0} className={`${btnPrimary} mt-6 w-full py-4`}>
                      {scheduleMode === 'now' ? `${selectedCount}개 채널에 발행` : `${selectedCount}개 채널 예약`}
                    </button>
                    {selectedCount === 0 && <p className="mt-2 text-center text-[12px] text-muted">채널을 하나 이상 선택하세요.</p>}
                  </section>

                  {/* Queue ledger */}
                  <section className="sheet mt-10">
                    <div className="flex items-baseline justify-between">
                      <span className="eyebrow">처리 목록</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted">{queue.length} items</span>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[440px] border-collapse text-left">
                        <thead>
                          <tr className="border-b border-rule font-mono text-[10px] uppercase tracking-label text-muted">
                            <th className="pb-2 font-normal">제품</th>
                            <th className="pb-2 font-normal">플랫폼</th>
                            <th className="pb-2 font-normal">상태</th>
                            <th className="pb-2 text-right font-normal">일시</th>
                          </tr>
                        </thead>
                        <tbody>
                          {queue.map(item => (
                            <tr
                              key={item.id}
                              tabIndex={0}
                              role="button"
                              onClick={() => setQueueDetail(item)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setQueueDetail(item);
                                }
                              }}
                              className="cursor-pointer border-b border-rule outline-none transition hover:bg-plate focus-visible:bg-plate"
                            >
                              <td className="py-3 pr-3 text-[13px]">{item.title}</td>
                              <td className="py-3 pr-3 font-mono text-[12px] text-muted">{item.platform}</td>
                              <td className={`py-3 pr-3 font-mono text-[12px] ${STATUS_TONE[item.status]}`}>{STATUS_KO[item.status]}</td>
                              <td className="py-3 text-right font-mono text-[12px] tabular-nums text-muted">{item.date}</td>
                            </tr>
                          ))}
                          <tr className="border-b border-rule bg-plate">
                            <td className="py-3 pr-3 text-[13px] font-bold">{liveTitle}</td>
                            <td className="py-3 pr-3 font-mono text-[12px] text-muted">{product.platform}</td>
                            <td className="py-3 pr-3 font-mono text-[12px] text-oak">현재 작업</td>
                            <td className="py-3 text-right font-mono text-[12px] text-muted">방금 전</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2.5 font-mono text-[11px] text-muted">행을 누르면 상세가 열립니다.</p>
                  </section>
                </>
              )}
            </div>
          )}
        </main>

        {/* Readings — a printed spec column, not a stack of cards. */}
        <aside className="hidden lg:sticky lg:top-[53px] lg:block lg:h-[calc(100vh-53px)] lg:overflow-y-auto lg:px-6 lg:py-7 lg:scrollbar-none">
          <div className="eyebrow">공정 상태</div>
          <dl className="mt-3">
            {STEPS.map(step => {
              const v = stepState(step.k);
              return (
                <div key={`st-${step.k}`} className="flex items-baseline justify-between border-b border-rule py-2.5">
                  <dt className="font-mono text-[11px] tracking-label text-muted">{step.label}</dt>
                  <dd className={`font-mono text-[11px] tabular-nums ${v === '완료' ? 'text-go' : v.endsWith('%') ? 'text-wait' : 'text-muted'}`}>{v}</dd>
                </div>
              );
            })}
          </dl>

          <div className="mt-8 border-l-2 border-oak pl-4">
            <div className="eyebrow">다음 할 일</div>
            <p className="mt-1.5 text-[13px] leading-relaxed">
              {activeTab === 0 && !product && '링크를 붙여넣고 분석을 시작하세요.'}
              {activeTab === 0 && product && '스튜디오로 이동해 영상을 생성하세요.'}
              {activeTab === 1 && !videoDone && !isGenerating && '템플릿을 고르고 영상을 생성하세요.'}
              {activeTab === 1 && isGenerating && '영상을 렌더링하고 있습니다.'}
              {activeTab === 1 && videoDone && '발행 탭에서 채널을 고르세요.'}
              {activeTab === 2 && '채널을 선택하고 발행하세요.'}
            </p>
          </div>

          <div className="mt-8">
            <div className="eyebrow">최근 로그</div>
            <ol className="mt-3 space-y-1.5 font-mono text-[11px] text-muted">
              {(aiLogs.length ? aiLogs : ['엔진 대기 중']).slice(-4).map((l, i) => (
                <li key={`rlog-${i}`} className="truncate">{l}</li>
              ))}
            </ol>
          </div>

          <div className="mt-8">
            <div className="eyebrow">출력 규격</div>
            <p className="mt-1.5 font-mono text-[11px] tabular-nums text-muted">{RENDER_SLATE}</p>
            <p className="mt-1 font-mono text-[11px] text-muted">자막 포함 · 세이프에어리어 준수</p>
          </div>
        </aside>
      </div>

      {/* Mobile step strip */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-3">
          {STEPS.map(step => {
            const on = activeTab === step.k;
            return (
              <button
                key={`mob-${step.k}`}
                type="button"
                onClick={() => setActiveTab(step.k)}
                className={`flex flex-col items-center gap-0.5 border-t-2 py-2.5 transition ${on ? 'border-oak' : 'border-transparent'}`}
              >
                <span className={`font-mono text-[9px] tabular-nums ${on ? 'text-oak' : 'text-muted'}`}>{step.no}</span>
                <span className={`text-[11px] font-bold tracking-label ${on ? '' : 'text-muted'}`}>{step.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Room preview */}
      {showRoom && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm" onClick={() => setShowRoom(false)}>
          <div
            className="w-full max-w-[720px] bg-plate p-6"
            style={{ boxShadow: '0 32px 64px -20px rgba(25,23,19,0.45)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <div className="eyebrow">룸 프리뷰</div>
                <h3 className="mt-1 font-serif text-[19px] font-bold">원룸 미니멀 구성 · {ROOM_ITEMS.length}점</h3>
              </div>
              <button type="button" onClick={() => setShowRoom(false)} aria-label="닫기" className="font-mono text-[11px] text-muted transition hover:text-ink">
                닫기 ✕
              </button>
            </div>
            <div className="mt-5 border border-rule">
              <RoomScene />
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-muted">
              {ROOM_ITEMS.map((item, i) => (
                <li key={`chip-${item.name}`}>
                  <span className="tabular-nums text-oak">{String(i + 1).padStart(2, '0')}</span> {item.name}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={openBuyLink} className={btnGhost}>
                구매 페이지 열기 ↗
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRoom(false);
                  setActiveTab(1);
                }}
                className={btnPrimary}
              >
                이 구성으로 영상 만들기 →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Queue detail */}
      {queueDetail && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm" onClick={() => setQueueDetail(null)}>
          <div
            className="w-full max-w-[400px] bg-plate p-6"
            style={{ boxShadow: '0 32px 64px -20px rgba(25,23,19,0.45)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="eyebrow">큐 항목 {String(queueDetail.id).padStart(2, '0')}</div>
            <h3 className="mt-1.5 font-serif text-[18px] font-bold leading-snug">{queueDetail.title}</h3>
            <dl className="mt-5">
              {[
                ['플랫폼', queueDetail.platform],
                ['상태', STATUS_KO[queueDetail.status]],
                ['처리 일시', queueDetail.date],
                ['누적 조회', queueDetail.views],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between border-b border-rule py-2.5">
                  <dt className="font-mono text-[11px] text-muted">{k}</dt>
                  <dd className="font-mono text-[12px] tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5">
              <div className="eyebrow">발행 채널</div>
              {queueDetail.channels.length > 0 ? (
                <ul className="mt-2 space-y-1 font-mono text-[12px]">
                  {queueDetail.channels.map(c => (
                    <li key={c}>
                      <span className="text-go">✓</span> {c}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 font-mono text-[12px] text-muted">아직 발행되지 않았습니다.</p>
              )}
            </div>
            <button type="button" onClick={() => setQueueDetail(null)} className={`${btnPrimary} mt-6 w-full`}>
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Publish result */}
      {showSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[380px] bg-plate p-6" style={{ boxShadow: '0 32px 64px -20px rgba(25,23,19,0.45)' }}>
            <div className="eyebrow text-go">{scheduleMode === 'now' ? '발행 완료' : '예약 완료'}</div>
            <h3 className="mt-1.5 font-serif text-[19px] font-bold leading-snug">
              {scheduleMode === 'now'
                ? `${selectedCount}개 채널에 올라갔습니다`
                : `${scheduleDate ? scheduleDate.replace('T', ' ') : '예약 시간'}에 올라갑니다`}
            </h3>
            <ul className="mt-5">
              {selectedChannels.map(c => (
                <li key={`succ-${c.key}`} className="flex items-baseline justify-between border-b border-rule py-2.5">
                  <span className="text-[13px]">{c.name}</span>
                  <span className="font-mono text-[11px] text-go">{scheduleMode === 'now' ? '완료' : '예약'}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setShowSuccess(false)} className={`${btnPrimary} flex-1`}>
                확인
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSuccess(false);
                  setActiveTab(0);
                  setLinkInput('');
                  setProduct(null);
                  setAiLogs([]);
                  setEditTitle('');
                  setEditPrice('');
                  setScriptText('');
                  setCaption('');
                  setScriptEdited(false);
                  setCaptionEdited(false);
                  setVideoDone(false);
                  setVideoProgress(0);
                }}
                className={btnGhost}
              >
                새 작업
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-24 left-1/2 z-[110] -translate-x-1/2 bg-ink px-4 py-2.5 font-mono text-[11px] text-plate md:bottom-8"
          style={{ animation: 'riseIn 200ms ease-out' }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
