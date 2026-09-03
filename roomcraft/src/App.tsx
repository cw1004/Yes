import React, { useState, useEffect, useMemo, useRef } from 'react';

import deskImg from '../assets/desk2_cutout.webp';
import chairImg from '../assets/chair_cutout.webp';
import lampImg from '../assets/lamp_cutout.webp';
import shelfImg from '../assets/shelf_cutout.webp';
import shelf2Img from '../assets/shelf2_cutout.webp';

type ProductImage = {
  src: string;
  label: string;
  swatch: string;
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
  { src: deskImg, label: '원목 데스크 800', swatch: '#D8C3A5', grain: 94 },
  { src: chairImg, label: '접이식 체어', swatch: '#C9A67D', grain: 92 },
  { src: lampImg, label: '펜던트 조명', swatch: '#E8DDD0', grain: 90 },
];

const ROOM_ITEMS = [
  { src: lampImg, name: '펜던트 조명', style: { left: '37%', top: '-1%', width: '10%' } },
  { src: shelfImg, name: '3단 오픈 선반', style: { left: '1%', bottom: '9%', width: '27%' } },
  { src: deskImg, name: '원목 데스크 800', style: { left: '28%', bottom: '8%', width: '45%' } },
  { src: shelf2Img, name: '박스 선반 600', style: { right: '1%', bottom: '9%', width: '25%' } },
  { src: chairImg, name: '접이식 체어', style: { left: '50%', bottom: '2%', width: '18%' } },
];

const LOGS_BASE = [
  '플랫폼 감지: {PLATFORM}',
  '이미지 분석: 원목 질감 94%',
  '가격 분석: 경쟁력 92%',
  'SEO 키워드: 원룸 책상 (12K)',
  '스크립트 생성 완료',
];

const TEMPLATES = [
  { id: 'A', name: '가격비교', label: 'A. 가격비교', desc: '정가 대비 할인율 강조' },
  { id: 'B', name: '조립타임랩스', label: 'B. 조립타임랩스', desc: '10초 조립, 원룸 변신' },
  { id: 'C', name: '스펙강조', label: 'C. 스펙강조', desc: '원목·내하중·접이식 포인트' },
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

const won = (n: number) => `₩${Math.max(0, Math.round(n)).toLocaleString('ko-KR')}`;

const RoomScene = ({ compact }: { compact?: boolean }) => (
  <div
    className="relative w-full overflow-hidden rounded-[18px] border border-black/10"
    style={{ aspectRatio: '4/3', background: 'linear-gradient(#F3EDE4 0%, #EFE7DB 62%, #E2D5C2 62%, #DCCCB6 100%)' }}
  >
    <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(120% 80% at 40% 20%, rgba(255,255,255,0.55), transparent 60%)' }} />
    {ROOM_ITEMS.map(item => (
      <img
        key={item.name}
        src={item.src}
        alt={item.name}
        className="absolute select-none"
        style={{ ...item.style, filter: 'drop-shadow(0 12px 14px rgba(60,40,20,0.20))' }}
      />
    ))}
    {compact && (
      <div className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-[10px] font-bold tracking-[0.12em] shadow-sm backdrop-blur">
        {ROOM_ITEMS.length} ITEMS PLACED
      </div>
    )}
  </div>
);

export default function App() {
  // Tabs
  const [activeTab, setActiveTab] = useState<number>(0);

  // IMPORT
  const [linkInput, setLinkInput] = useState<string>('');
  const [product, setProduct] = useState<Product | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [aiLogs, setAiLogs] = useState<string[]>([]);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editPrice, setEditPrice] = useState<string>('');
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
  const tabs = [
    { k: 0, label: 'IMPORT', sub: '제품 가져오기', ko: '가져오기' },
    { k: 1, label: 'STUDIO', sub: '영상 스튜디오', ko: '스튜디오' },
    { k: 2, label: 'PUBLISH', sub: 'SNS 발행', ko: '발행' },
  ];

  return (
    <div className="min-h-screen w-full antialiased selection:bg-[#8B5A2B]/20" style={{ backgroundColor: '#FAF7F2', color: '#121212' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-black/10 backdrop-blur-xl" style={{ backgroundColor: 'rgba(250,247,242,0.85)' }}>
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 md:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#121212] text-[11px] font-bold tracking-widest text-white">RC</div>
            <div className="leading-none">
              <div className="text-[13px] font-black tracking-[0.18em]">ROOMCRAFT.WORLD</div>
              <div className="mt-0.5 text-[11px] font-medium tracking-[0.12em] opacity-60">AUTO FACTORY — V3</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] md:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              <span className="font-semibold tracking-wide">LIVE ENGINE</span>
              <span className="tabular-nums opacity-60">{aiLogs.length}/5 logs</span>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-[#121212] px-4 py-1.5 text-[11px] font-semibold tracking-wide text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#C9A67D]" />
              LIVE
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 md:grid-cols-[220px_1fr_360px] md:gap-6">
        {/* Left nav — desktop */}
        <aside className="hidden border-r border-black/5 px-4 py-6 md:sticky md:top-[65px] md:flex md:h-[calc(100vh-65px)] md:flex-col md:justify-between">
          <div>
            <div className="mb-6 px-2 text-[11px] font-bold tracking-[0.14em] opacity-40">WORKFLOW</div>
            <div className="flex flex-col gap-2">
              {tabs.map(tab => (
                <button
                  key={tab.k}
                  type="button"
                  onClick={() => setActiveTab(tab.k)}
                  aria-current={activeTab === tab.k ? 'step' : undefined}
                  className={`flex w-full flex-col items-start rounded-2xl border px-4 py-3 text-left transition-all ${
                    activeTab === tab.k ? 'border-[#8B5A2B] bg-white shadow-sm' : 'border-transparent hover:bg-white/60'
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className={`text-[12px] font-black tracking-[0.12em] ${activeTab === tab.k ? 'text-[#8B5A2B]' : 'opacity-70'}`}>{tab.label}</span>
                    <span className={`h-2 w-2 rounded-full ${activeTab === tab.k ? 'bg-[#8B5A2B]' : 'bg-black/10'}`} />
                  </div>
                  <span className="mt-1 text-[13px] font-medium opacity-80">{tab.sub}</span>
                </button>
              ))}
            </div>

            <div className="mt-8 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-bold tracking-wide opacity-50">현재 제품</div>
              {product ? (
                <div className="mt-3">
                  <div className="flex h-[64px] items-end justify-center rounded-xl bg-[#F3EDE4] p-1">
                    <img src={product.images[0].src} alt={liveTitle} className="max-h-full w-auto object-contain" />
                  </div>
                  <div className="mt-3 line-clamp-2 text-[13px] font-semibold leading-5">{liveTitle}</div>
                  <div className="mt-1 text-[12px] tabular-nums opacity-60">{product.platform} · {won(livePrice)}</div>
                </div>
              ) : (
                <div className="mt-3 text-[13px] opacity-50">아직 가져온 제품이 없습니다.</div>
              )}
            </div>
          </div>

          <div className="px-2 py-4 text-[11px] opacity-40">
            <div>Build v3.0</div>
            <div className="mt-1">© ROOMCRAFT.WORLD</div>
          </div>
        </aside>

        {/* Center */}
        <main className="min-h-[calc(100vh-140px)] px-4 pb-28 pt-6 md:px-6 md:pb-6 md:pt-8">
          {/* ── IMPORT ── */}
          {activeTab === 0 && (
            <div className="mx-auto max-w-[720px]">
              <div className="mb-8">
                <h1 className="text-[28px] font-extrabold leading-[1.15] tracking-[-0.02em] [text-wrap:balance]">
                  제품 링크를 붙여넣으면<br />AI가 나머지를 처리합니다.
                </h1>
                <p className="mt-3 max-w-[560px] text-[14px] leading-6 opacity-60">
                  쿠팡, 아마존, 알리익스프레스, 이베이 링크를 분석해 제목·가격·SEO·스크립트까지 자동 생성합니다.
                </p>
              </div>

              <div className="rounded-[20px] border border-black/10 bg-white p-4 shadow-sm md:p-5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">PRODUCT LINK</div>
                  <div className="text-[11px] opacity-40">지원: Coupang · Amazon · AliExpress · eBay</div>
                </div>
                <form
                  className="mt-3 flex flex-col gap-3 md:flex-row"
                  onSubmit={e => {
                    e.preventDefault();
                    handleAnalyze();
                  }}
                >
                  <input
                    id="product-link-input"
                    value={linkInput}
                    onChange={e => setLinkInput(e.target.value)}
                    placeholder="쿠팡, 아마존, 알리, 이베이 링크를 붙여넣으세요"
                    className="h-[48px] w-full flex-1 rounded-full border border-black/10 bg-[#FAF7F2] px-5 text-[14px] outline-none transition focus:border-[#8B5A2B] focus:bg-white"
                  />
                  <button
                    type="submit"
                    disabled={isAnalyzing || !linkInput.trim()}
                    className="h-[48px] shrink-0 rounded-full bg-[#121212] px-6 text-[14px] font-semibold text-white transition hover:bg-black disabled:opacity-30"
                  >
                    {isAnalyzing ? '분석 중...' : '분석하기'}
                  </button>
                </form>

                {(aiLogs.length > 0 || isAnalyzing) && (
                  <div className="mt-5 rounded-2xl bg-[#121212] p-4 text-white">
                    <div className="mb-3 flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] opacity-60">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                      AI ENGINE LOG
                    </div>
                    <div className="space-y-2 font-mono text-[13px] leading-5">
                      {aiLogs.map((log, i) => (
                        <div key={`log-${i}`} className="flex gap-3">
                          <span className="tabular-nums opacity-40">{String(i + 1).padStart(2, '0')}</span>
                          <span>{log}</span>
                        </div>
                      ))}
                      {isAnalyzing && (
                        <div className="flex gap-3 opacity-60">
                          <span className="tabular-nums opacity-40">{String(aiLogs.length + 1).padStart(2, '0')}</span>
                          <span className="inline-flex items-center gap-2">
                            <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" /> 처리 중...
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="opacity-40">예시:</span>
                  {EXAMPLE_LINKS.map(ex => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => {
                        setLinkInput(ex);
                        showToast(`예시 적용: ${ex.replace('https://www.', '')}`);
                      }}
                      className={`rounded-full border px-3 py-1 transition ${
                        linkInput === ex ? 'border-[#8B5A2B] bg-[#8B5A2B] text-white' : 'border-black/10 bg-[#FAF7F2] hover:bg-white'
                      }`}
                    >
                      {linkInput === ex ? '✓ ' : ''}
                      {ex.replace('https://www.', '')}
                    </button>
                  ))}
                </div>
              </div>

              {product ? (
                <>
                  <div className="mt-6 rounded-[20px] border border-black/10 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="inline-flex items-center gap-2 rounded-full bg-[#8B5A2B]/10 px-3 py-1 text-[11px] font-bold tracking-wide text-[#8B5A2B]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#8B5A2B]" />
                          {product.platform} 감지됨
                        </div>
                        <h2 className="mt-3 max-w-[420px] text-[18px] font-bold leading-6 tracking-[-0.01em]">{liveTitle}</h2>
                      </div>
                      <div className="text-right">
                        <div className="text-[12px] tabular-nums opacity-50 line-through">{won(originalPrice)}</div>
                        <div className="text-[18px] font-black tabular-nums">{won(livePrice)}</div>
                        <div className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-emerald-700">{discount}% OFF</div>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-3 gap-3">
                      {product.images.map((img, idx) => (
                        <figure key={img.label} className="group relative overflow-hidden rounded-2xl border border-black/5" style={{ backgroundColor: img.swatch, aspectRatio: '4/3' }}>
                          <img src={img.src} alt={img.label} className="absolute inset-0 h-full w-full object-contain p-2 transition duration-300 group-hover:scale-105" />
                          <figcaption className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold">IMG {idx + 1}</figcaption>
                          <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition group-hover:opacity-100">
                            <div className="rounded-full bg-black/75 px-3 py-1 text-[11px] text-white">원목 질감 {img.grain}%</div>
                          </div>
                        </figure>
                      ))}
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label htmlFor="edit-title" className="text-[11px] font-bold tracking-wide opacity-50">제품명 (편집 가능)</label>
                        <input
                          id="edit-title"
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          className="mt-2 w-full rounded-xl border border-black/10 bg-[#FAF7F2] px-4 py-3 text-[14px] font-medium outline-none focus:border-[#8B5A2B] focus:bg-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="edit-price" className="text-[11px] font-bold tracking-wide opacity-50">판매가 (편집 가능)</label>
                        <input
                          id="edit-price"
                          value={editPrice}
                          onChange={e => setEditPrice(e.target.value.replace(/[^0-9]/g, ''))}
                          inputMode="numeric"
                          className="mt-2 w-full rounded-xl border border-black/10 bg-[#FAF7F2] px-4 py-3 text-[14px] font-medium tabular-nums outline-none focus:border-[#8B5A2B] focus:bg-white"
                        />
                        <div className="mt-1.5 text-[11px] opacity-50">스크립트·캡션·미리보기에 바로 반영됩니다.</div>
                      </div>
                    </div>

                    <div className="mt-6 rounded-2xl bg-[#FAF7F2] p-4">
                      <div className="text-[11px] font-bold tracking-wide opacity-50">AFFILIATE LINK PREVIEW</div>
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="truncate rounded-xl border border-black/10 bg-white px-3 py-2 text-[12px] opacity-60">{product.originalLink}</div>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px]">↓</span>
                          <span className="text-[11px] font-bold tracking-wide text-[#8B5A2B]">ROOMCRAFT AFFILIATE</span>
                        </div>
                        <div className="truncate rounded-xl bg-[#121212] px-3 py-2 font-mono text-[12px] text-white">{product.affiliate}</div>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={openBuyLink}
                        className="rounded-full border border-black/15 px-5 py-3 text-[13px] font-semibold transition hover:bg-[#FAF7F2]"
                      >
                        구매 페이지 열기 ↗
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab(1)}
                        className="rounded-full bg-[#8B5A2B] px-6 py-3 text-[13px] font-bold text-white transition hover:bg-[#6F4A24]"
                      >
                        스튜디오로 이동 →
                      </button>
                    </div>
                  </div>

                  {/* Room preview */}
                  <button
                    type="button"
                    onClick={() => setShowRoom(true)}
                    className="mt-6 block w-full rounded-[20px] border border-black/10 bg-white p-5 text-left shadow-sm transition hover:border-[#8B5A2B]/40 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">ROOM PREVIEW — 미니멀</div>
                      <span className="text-[11px] font-semibold text-[#8B5A2B]">크게 보기 →</span>
                    </div>
                    <div className="mt-3">
                      <RoomScene compact />
                    </div>
                    <div className="mt-3 text-[12px] opacity-60">이 제품을 포함한 원룸 구성 {ROOM_ITEMS.length}점. 클릭하면 전체 화면으로 확인합니다.</div>
                  </button>
                </>
              ) : (
                !isAnalyzing && (
                  <div className="mt-6 rounded-[20px] border border-dashed border-black/15 bg-white/60 p-10 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#FAF7F2] text-[20px]">📦</div>
                    <div className="mt-3 text-[14px] font-semibold">아직 분석된 제품이 없습니다</div>
                    <div className="mt-1 text-[13px] opacity-50">링크를 붙여넣고 분석하기를 눌러주세요.</div>
                  </div>
                )
              )}
            </div>
          )}

          {/* ── STUDIO ── */}
          {activeTab === 1 && (
            <div className="mx-auto max-w-[960px]">
              {!product ? (
                <div className="rounded-[20px] border border-dashed border-black/15 bg-white p-12 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#FAF7F2] text-[20px]">🎬</div>
                  <div className="mt-4 text-[16px] font-bold">먼저 제품을 가져오세요</div>
                  <div className="mt-2 text-[13px] opacity-60">IMPORT 탭에서 링크를 분석하면 스튜디오가 활성화됩니다.</div>
                  <button type="button" onClick={() => setActiveTab(0)} className="mt-6 rounded-full bg-[#121212] px-5 py-2.5 text-[13px] font-semibold text-white">
                    IMPORT로 이동
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
                  <div>
                    <div className="mb-6 flex items-center justify-between gap-3">
                      <h2 className="text-[20px] font-bold tracking-[-0.01em]">영상 스튜디오</h2>
                      <div className="truncate text-[11px] opacity-50">{liveTitle} 편집 중</div>
                    </div>

                    <div className="rounded-[20px] border border-black/10 bg-white p-4 shadow-sm">
                      <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">TEMPLATE</div>
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                        {TEMPLATES.map((t, idx) => (
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
                            className={`rounded-2xl border p-3 text-left transition ${
                              templateIdx === idx ? 'border-[#8B5A2B] bg-[#8B5A2B]/5' : 'border-black/10 bg-[#FAF7F2] hover:bg-white'
                            }`}
                          >
                            <div className={`text-[12px] font-black ${templateIdx === idx ? 'text-[#8B5A2B]' : ''}`}>{t.label}</div>
                            <div className="mt-1 text-[12px] font-medium opacity-70">{t.desc}</div>
                            {templateIdx === idx && <div className="mt-2 h-1 w-8 rounded-full bg-[#8B5A2B]" />}
                          </button>
                        ))}
                      </div>

                      <div className="mt-6">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">
                            SCRIPT (편집 가능){scriptEdited && <span className="ml-2 font-semibold tracking-normal text-[#8B5A2B]">직접 수정됨</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setScriptEdited(false);
                              setScriptText(makeScript(liveTitle, livePrice, originalPrice, discount, templateIdx));
                              showToast('스크립트를 현재 제품 정보로 다시 생성했습니다');
                            }}
                            className="rounded-full border border-black/10 px-3 py-1 text-[11px] hover:bg-[#FAF7F2]"
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
                          className="mt-3 min-h-[240px] w-full resize-none rounded-2xl border border-black/10 bg-[#FAF7F2] p-4 text-[14px] leading-6 outline-none focus:border-[#8B5A2B] focus:bg-white"
                        />
                        <div className="mt-2 text-right text-[11px] tabular-nums opacity-40">{scriptText.length}자 · 9:16 최적화</div>
                      </div>

                      <div className="mt-6">
                        <button
                          type="button"
                          onClick={handleGenerate}
                          disabled={isGenerating}
                          className={`flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[14px] font-bold text-white transition ${
                            videoDone ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-[#121212] hover:bg-black disabled:opacity-40'
                          }`}
                        >
                          {isGenerating ? (
                            <>
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              <span className="tabular-nums">생성 중 {videoProgress}%</span>
                            </>
                          ) : videoDone ? (
                            '✓ 생성 완료 — 다시 생성'
                          ) : (
                            '▶ 영상 생성하기'
                          )}
                        </button>

                        {(isGenerating || videoDone) && (
                          <div className="mt-4">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
                              <div className="h-full rounded-full bg-[#8B5A2B] transition-all duration-300" style={{ width: `${videoProgress}%` }} />
                            </div>
                            <div className="mt-2 flex justify-between text-[11px] opacity-50">
                              <span>{videoDone ? '렌더링 완료' : 'FFmpeg 렌더링 중...'}</span>
                              <span className="tabular-nums">{videoProgress}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 9:16 preview */}
                  <div className="lg:sticky lg:top-[88px] lg:h-fit">
                    <div className="rounded-[20px] border border-black/10 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">PREVIEW — 9:16</div>
                        <div className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${videoDone ? 'bg-emerald-50 text-emerald-700' : 'bg-black/5'}`}>
                          {videoDone ? 'DONE' : 'DRAFT'}
                        </div>
                      </div>

                      <div className="relative mx-auto w-full max-w-[300px] overflow-hidden rounded-[20px] border border-black/10 shadow-lg" style={{ aspectRatio: '9/16', backgroundColor: '#1A1A1A' }}>
                        <div className="absolute left-0 right-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent p-3">
                          <div className="line-clamp-2 text-[12px] font-bold leading-4 text-white">{liveTitle}</div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                            <span className="text-[10px] font-semibold tracking-wide text-white/70">ROOMCRAFT ENGINE</span>
                          </div>
                        </div>

                        <div className="absolute inset-0 flex flex-col justify-center gap-3 p-3 pb-[132px] pt-16">
                          <div className="overflow-hidden rounded-2xl">
                            <div className="flex gap-3" style={{ animation: 'slideX 6s ease-in-out infinite' }}>
                              {[...product.images, ...product.images].map((img, i) => (
                                <div key={`slide-${i}`} className="relative h-[168px] w-[184px] shrink-0 overflow-hidden rounded-2xl border border-white/10" style={{ backgroundColor: img.swatch }}>
                                  <img src={img.src} alt="" className="absolute inset-0 h-full w-full object-contain p-2" />
                                  <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-1 text-[9px] text-white">원목 {img.grain}%</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {product.images.map(img => (
                              <div key={`mini-${img.label}`} className="rounded-xl bg-white/10 p-2 backdrop-blur">
                                <div className="flex h-8 items-center justify-center overflow-hidden rounded-lg" style={{ backgroundColor: img.swatch }}>
                                  <img src={img.src} alt="" className="h-full w-auto object-contain" />
                                </div>
                                <div className="mt-2 h-2 w-3/4 rounded bg-white/20" />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="absolute bottom-14 left-3 right-3 z-10">
                          <div className="rounded-2xl bg-white p-3 shadow-xl">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-[10px] font-bold tracking-wide opacity-50">TODAY ONLY</div>
                                <div className="text-[15px] font-black tabular-nums">{won(livePrice)}</div>
                              </div>
                              <button
                                type="button"
                                onClick={openBuyLink}
                                className="rounded-full bg-[#121212] px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-black"
                              >
                                구매하기
                              </button>
                            </div>
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                              <div className="h-full bg-[#8B5A2B] transition-all duration-300" style={{ width: `${Math.min(100, discount)}%` }} />
                            </div>
                          </div>
                        </div>

                        <div className="absolute bottom-3 left-0 right-0 z-10 flex justify-center">
                          <div className="rounded-full bg-black/60 px-3 py-1 text-[9px] font-bold tracking-[0.14em] text-white/80 backdrop-blur">ROOMCRAFT.WORLD</div>
                        </div>

                        <div className="absolute left-3 top-[76px] z-10 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold shadow">{TEMPLATES[templateIdx].name}</div>
                      </div>

                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveTab(2)}
                          disabled={!videoDone}
                          className="flex-1 rounded-full bg-[#8B5A2B] py-2.5 text-[12px] font-bold text-white transition hover:bg-[#6F4A24] disabled:opacity-30"
                        >
                          발행 단계로 →
                        </button>
                        <button
                          type="button"
                          onClick={() => showToast('초안을 저장했습니다')}
                          className="rounded-full border border-black/10 px-4 py-2.5 text-[12px] font-semibold hover:bg-[#FAF7F2]"
                        >
                          저장
                        </button>
                      </div>

                      <div className="mt-3 text-center text-[11px] opacity-40">1080×1920 · H.264 · 12초 · 자막 포함</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── PUBLISH ── */}
          {activeTab === 2 && (
            <div className="mx-auto max-w-[720px]">
              <div className="mb-6">
                <h2 className="text-[20px] font-bold tracking-[-0.01em]">SNS 발행</h2>
                <p className="mt-2 text-[13px] opacity-60">생성된 영상을 선택한 채널에 동시 발행합니다. 해시태그는 자동 최적화됩니다.</p>
              </div>

              {!product ? (
                <div className="rounded-[20px] border border-dashed border-black/15 bg-white p-10 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#FAF7F2] text-[18px]">📤</div>
                  <div className="mt-3 text-[14px] font-semibold">발행할 영상이 없습니다</div>
                  <div className="mt-1 text-[12px] opacity-50">IMPORT → STUDIO를 완료하면 발행할 수 있습니다.</div>
                </div>
              ) : (
                <>
                  <div className="rounded-[20px] border border-black/10 bg-white p-5 shadow-sm">
                    <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">CHANNELS</div>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {CHANNELS.map(ch => (
                        <label
                          key={ch.key}
                          className={`flex cursor-pointer items-center justify-between rounded-2xl border p-3 transition ${
                            sns[ch.key] ? 'border-[#8B5A2B] bg-[#8B5A2B]/5' : 'border-black/10 bg-[#FAF7F2] hover:bg-white'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={sns[ch.key]}
                              onChange={e => setSns(prev => ({ ...prev, [ch.key]: e.target.checked }))}
                              className="h-4 w-4 accent-[#8B5A2B]"
                            />
                            <div>
                              <div className="text-[13px] font-bold">{ch.name}</div>
                              <div className="text-[11px] opacity-60">{ch.sub}</div>
                            </div>
                          </div>
                          <div className="text-[11px] font-bold tabular-nums opacity-40">{ch.count}</div>
                        </label>
                      ))}
                    </div>

                    <div className="mt-6">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">
                          CAPTION{captionEdited && <span className="ml-2 font-semibold tracking-normal text-[#8B5A2B]">직접 수정됨</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setCaptionEdited(false);
                            setCaption(makeCaption(liveTitle, livePrice, discount));
                            showToast('캡션을 다시 생성했습니다');
                          }}
                          className="rounded-full border border-black/10 px-3 py-1 text-[11px] hover:bg-[#FAF7F2]"
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
                        className="mt-3 min-h-[140px] w-full resize-none rounded-2xl border border-black/10 bg-[#FAF7F2] p-4 text-[13px] leading-5 outline-none focus:border-[#8B5A2B] focus:bg-white"
                      />
                      <div className="mt-2 flex justify-between text-[11px] tabular-nums opacity-40">
                        <span>{selectedCount}개 채널 선택됨</span>
                        <span>{caption.length}자</span>
                      </div>
                    </div>

                    <div className="mt-6 rounded-2xl bg-[#FAF7F2] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">SCHEDULE</div>
                        <div className="flex rounded-full border border-black/10 bg-white p-1 text-[11px]">
                          {(['now', 'later'] as const).map(mode => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setScheduleMode(mode)}
                              className={`rounded-full px-3 py-1 font-semibold transition ${scheduleMode === mode ? 'bg-[#121212] text-white' : 'opacity-60'}`}
                            >
                              {mode === 'now' ? '즉시 발행' : '예약 발행'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {scheduleMode === 'later' && (
                        <input
                          type="datetime-local"
                          value={scheduleDate}
                          onChange={e => setScheduleDate(e.target.value)}
                          className="mt-3 w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-[13px] outline-none focus:border-[#8B5A2B]"
                        />
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handlePublish}
                      disabled={selectedCount === 0}
                      className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#121212] py-3.5 text-[14px] font-bold text-white transition hover:bg-black disabled:opacity-30"
                    >
                      {scheduleMode === 'now' ? `🚀 ${selectedCount}개 채널에 발행하기` : `🗓️ ${selectedCount}개 채널 예약하기`}
                    </button>
                    {selectedCount === 0 && <div className="mt-2 text-center text-[11px] opacity-50">채널을 하나 이상 선택하세요.</div>}
                  </div>

                  {/* Queue */}
                  <div className="mt-8 rounded-[20px] border border-black/10 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">QUEUE — 최근 처리 목록</div>
                      <div className="text-[11px] tabular-nums opacity-40">{queue.length} items</div>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[420px] text-left">
                        <thead>
                          <tr className="border-b border-black/5 text-[11px] opacity-40">
                            <th className="pb-2 font-semibold">제품</th>
                            <th className="pb-2 font-semibold">플랫폼</th>
                            <th className="pb-2 font-semibold">상태</th>
                            <th className="pb-2 font-semibold">일시</th>
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
                              className="cursor-pointer border-b border-black/5 outline-none transition last:border-0 hover:bg-[#FAF7F2] focus-visible:bg-[#FAF7F2] focus-visible:ring-2 focus-visible:ring-[#8B5A2B]/40"
                            >
                              <td className="py-3 text-[13px] font-medium">{item.title}</td>
                              <td className="py-3 text-[12px] opacity-70">{item.platform}</td>
                              <td className="py-3">
                                <span
                                  className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                    item.status === 'Posted'
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : item.status === 'Video Done'
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-[#8B5A2B]/10 text-[#8B5A2B]'
                                  }`}
                                >
                                  {STATUS_KO[item.status]}
                                </span>
                              </td>
                              <td className="py-3 text-[12px] tabular-nums opacity-50">{item.date}</td>
                            </tr>
                          ))}
                          <tr className="bg-[#FAF7F2]/60">
                            <td className="py-3 text-[13px] font-bold">{liveTitle}</td>
                            <td className="py-3 text-[12px] opacity-70">{product.platform}</td>
                            <td className="py-3">
                              <span className="inline-flex rounded-full bg-[#121212] px-2.5 py-1 text-[11px] font-bold text-white">현재 작업</span>
                            </td>
                            <td className="py-3 text-[12px] opacity-50">방금 전</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 text-[11px] opacity-40">행을 클릭하면 상세 정보가 열립니다.</div>
                  </div>
                </>
              )}
            </div>
          )}
        </main>

        {/* Right panel — desktop */}
        <aside className="hidden border-l border-black/5 px-4 py-6 md:sticky md:top-[65px] md:block md:h-[calc(100vh-65px)] md:overflow-y-auto md:scrollbar-none">
          <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">FACTORY STATUS</div>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-[#FAF7F2] p-3">
                <span className="text-[12px] opacity-60">IMPORT</span>
                <span className={`text-[11px] font-bold ${product ? 'text-emerald-600' : 'opacity-30'}`}>{product ? '✓ 완료' : '대기'}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[#FAF7F2] p-3">
                <span className="text-[12px] opacity-60">STUDIO</span>
                <span className={`text-[11px] font-bold tabular-nums ${videoDone ? 'text-emerald-600' : isGenerating ? 'text-amber-600' : 'opacity-30'}`}>
                  {videoDone ? '✓ 완료' : isGenerating ? `${videoProgress}%` : '대기'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[#FAF7F2] p-3">
                <span className="text-[12px] opacity-60">PUBLISH</span>
                <span className="text-[11px] font-bold tabular-nums opacity-40">{selectedCount} 채널</span>
              </div>
            </div>

            <div className="mt-6 rounded-xl bg-[#121212] p-4 text-white">
              <div className="text-[11px] font-bold tracking-wide opacity-60">NEXT ACTION</div>
              <div className="mt-2 text-[13px] font-medium leading-5">
                {activeTab === 0 && !product && '링크를 붙여넣고 분석을 시작하세요.'}
                {activeTab === 0 && product && '스튜디오로 이동해 영상을 생성하세요.'}
                {activeTab === 1 && !videoDone && !isGenerating && '템플릿을 고르고 영상을 생성하세요.'}
                {activeTab === 1 && isGenerating && '영상을 렌더링 중입니다...'}
                {activeTab === 1 && videoDone && '발행 탭에서 SNS에 배포하세요.'}
                {activeTab === 2 && '채널을 선택하고 발행하세요.'}
              </div>
            </div>

            <div className="mt-6">
              <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">RECENT LOGS</div>
              <div className="mt-3 space-y-2 font-mono text-[11px]">
                {(aiLogs.length ? aiLogs : ['대기 중...', '링크 분석 대기', '엔진 아이들 상태']).slice(-4).map((l, i) => (
                  <div key={`rlog-${i}`} className="truncate opacity-60">› {l}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-black/10 bg-[#8B5A2B]/5 p-4">
            <div className="text-[11px] font-bold text-[#8B5A2B]">TIP</div>
            <div className="mt-1 text-[12px] leading-5 opacity-70">가격비교 템플릿이 CTR이 가장 높습니다. 할인 배지를 꼭 유지하세요.</div>
          </div>
        </aside>
      </div>

      {/* Mobile nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-black/10 bg-white/90 px-2 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-3 gap-2">
          {tabs.map(tab => (
            <button
              key={`mob-${tab.k}`}
              type="button"
              onClick={() => setActiveTab(tab.k)}
              className={`flex flex-col items-center rounded-2xl px-2 py-2.5 transition ${
                activeTab === tab.k ? 'bg-[#121212] text-white' : 'bg-[#FAF7F2] text-black/60'
              }`}
            >
              <span className="text-[11px] font-black tracking-wide">{tab.label}</span>
              <span className="text-[11px] opacity-70">{tab.ko}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Room preview modal */}
      {showRoom && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowRoom(false)}>
          <div className="w-full max-w-[760px] rounded-[24px] border border-black/10 bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">ROOM PREVIEW</div>
                <div className="mt-1 text-[17px] font-bold">원룸 미니멀 구성 — {ROOM_ITEMS.length} items placed</div>
              </div>
              <button type="button" onClick={() => setShowRoom(false)} aria-label="닫기" className="rounded-full border border-black/10 px-3 py-1.5 text-[13px] hover:bg-[#FAF7F2]">
                닫기
              </button>
            </div>
            <div className="mt-4">
              <RoomScene />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ROOM_ITEMS.map(item => (
                <span key={`chip-${item.name}`} className="rounded-full bg-[#FAF7F2] px-2.5 py-1 text-[11px] font-semibold text-[#8B5A2B]">
                  {item.name}
                </span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={openBuyLink} className="rounded-full border border-black/15 px-5 py-2.5 text-[13px] font-semibold hover:bg-[#FAF7F2]">
                구매 페이지 열기 ↗
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRoom(false);
                  setActiveTab(1);
                }}
                className="rounded-full bg-[#8B5A2B] px-5 py-2.5 text-[13px] font-bold text-white hover:bg-[#6F4A24]"
              >
                이 구성으로 영상 만들기 →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Queue detail modal */}
      {queueDetail && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setQueueDetail(null)}>
          <div className="w-full max-w-[420px] rounded-[24px] border border-black/10 bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-[11px] font-bold tracking-[0.12em] opacity-50">QUEUE ITEM #{queueDetail.id}</div>
            <div className="mt-2 text-[17px] font-bold leading-6">{queueDetail.title}</div>
            <dl className="mt-5 space-y-2">
              {[
                ['플랫폼', queueDetail.platform],
                ['상태', STATUS_KO[queueDetail.status]],
                ['처리 일시', queueDetail.date],
                ['누적 조회', queueDetail.views],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-xl bg-[#FAF7F2] px-4 py-2.5">
                  <dt className="text-[12px] opacity-60">{k}</dt>
                  <dd className="text-[13px] font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4">
              <div className="text-[11px] font-bold tracking-wide opacity-50">발행 채널</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {queueDetail.channels.length > 0 ? (
                  queueDetail.channels.map(c => (
                    <span key={c} className="rounded-full bg-[#8B5A2B]/10 px-2.5 py-1 text-[11px] font-semibold text-[#8B5A2B]">{c}</span>
                  ))
                ) : (
                  <span className="text-[12px] opacity-50">아직 발행되지 않았습니다.</span>
                )}
              </div>
            </div>
            <button type="button" onClick={() => setQueueDetail(null)} className="mt-6 w-full rounded-full bg-[#121212] py-3 text-[13px] font-bold text-white">
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Publish success modal */}
      {showSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[380px] rounded-[24px] border border-black/10 bg-white p-6 shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-[24px] text-emerald-600">✓</div>
            <div className="mt-4 text-center">
              <div className="text-[18px] font-bold">{scheduleMode === 'now' ? '발행 완료!' : '예약 완료!'}</div>
              <div className="mt-1 text-[13px] opacity-60">
                {scheduleMode === 'now'
                  ? '선택한 채널에 즉시 발행되었습니다.'
                  : `${scheduleDate ? scheduleDate.replace('T', ' ') : '예약 시간'}에 발행됩니다.`}
              </div>
            </div>

            <div className="mt-6 space-y-2">
              {selectedChannels.map(c => (
                <div key={`succ-${c.key}`} className="flex items-center justify-between rounded-xl bg-[#FAF7F2] px-4 py-3">
                  <span className="text-[13px] font-medium">{c.name}</span>
                  <span className="flex items-center gap-1.5 text-[12px] font-bold text-emerald-600">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] text-white">✓</span>
                    {scheduleMode === 'now' ? '완료' : '예약'}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6 flex gap-2">
              <button type="button" onClick={() => setShowSuccess(false)} className="flex-1 rounded-full bg-[#121212] py-3 text-[13px] font-bold text-white">
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
                className="rounded-full border border-black/10 px-5 py-3 text-[13px] font-semibold hover:bg-[#FAF7F2]"
              >
                새 작업
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div role="status" className="pointer-events-none fixed bottom-24 left-1/2 z-[110] -translate-x-1/2 rounded-full bg-[#121212] px-4 py-2 text-[12px] font-medium text-white shadow-lg md:bottom-8">
          {toast}
        </div>
      )}
    </div>
  );
}
