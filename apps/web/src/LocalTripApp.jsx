import { useEffect, useMemo, useState } from 'react';

const DEFAULT_IMAGES = [
  'https://images.unsplash.com/photo-1538485399081-7c8edc8e7f8a?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1519677100203-a0e668c92439?auto=format&fit=crop&w=1200&q=80'
];

const FALLBACK_DESTINATIONS = [
  {
    id: 'seoul-seongsu',
    name: 'Seongsu, Seoul',
    region: 'Seoul',
    summary: 'Design studios, cafes, river walks, and small galleries packed into a compact city route.',
    tags: ['design', 'cafes', 'walkable'],
    category: 'City',
    rating: 4.8,
    liveVisitors: 18420,
    imageUrl: DEFAULT_IMAGES[0]
  },
  {
    id: 'busan-yeongdo',
    name: 'Yeongdo, Busan',
    region: 'Busan',
    summary: 'Harbor viewpoints, market food, coastal roads, and slower neighborhoods beyond the beach strip.',
    tags: ['coast', 'food', 'views'],
    category: 'Coast',
    rating: 4.7,
    liveVisitors: 12650,
    imageUrl: DEFAULT_IMAGES[1]
  },
  {
    id: 'jeju-seogwipo',
    name: 'Seogwipo, Jeju',
    region: 'Jeju',
    summary: 'Waterfalls, local markets, volcanic trails, and quiet stays for a restorative island plan.',
    tags: ['nature', 'market', 'slow'],
    category: 'Nature',
    rating: 4.9,
    liveVisitors: 15310,
    imageUrl: DEFAULT_IMAGES[2]
  }
];

const INTERESTS = ['맛집', '자연', '역사', '카페', '가족', '커플', '사진'];

async function localTripRequest(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error((await response.text()) || `HTTP ${response.status}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function pickString(...values) {
  const value = values.find((item) => item !== undefined && item !== null && `${item}`.trim());
  return value === undefined ? '' : `${value}`.trim();
}

function pickNumber(...values) {
  const value = values.find((item) => item !== undefined && item !== null && item !== '');
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readArray(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeTags(...values) {
  const tags = [];
  for (const value of values) {
    const parsed = parseMaybeJson(value);
    if (Array.isArray(parsed)) {
      tags.push(...parsed.map((tag) => `${tag}`.trim()).filter(Boolean));
      continue;
    }
    if (typeof parsed === 'string' && parsed.trim()) {
      tags.push(...parsed.split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean));
    }
  }
  return Array.from(new Set(tags)).slice(0, 6);
}

function normalizeDestination(raw, index = 0) {
  const row = raw || {};
  const tags = normalizeTags(row.styleTags, row.style_tags, row.primaryStyle, row.primary_style, row.tags, row.tagsJson, row.tags_json, row.keywords);
  const id = pickString(row.id, row.destinationId, row.destination_id, row.placeId, row.place_id, row.code) || `destination-${index}`;
  return {
    id,
    name: pickString(row.name, row.title, row.destinationName, row.destination_name, row.placeName, row.place_name, row.districtName, row.district_name) || 'Untitled destination',
    region: pickString(row.region, row.regionName, row.region_name, row.area, row.districtName, row.district_name) || 'Local area',
    summary: pickString(row.summary, row.headline, row.description, row.overview, row.introduction) || 'Curated local stops, timing, and route ideas are ready for this area.',
    category: pickString(row.category, row.primaryStyle, row.primary_style, row.theme, row.destinationType, row.type) || 'Local',
    address: pickString(row.address, row.roadAddress, row.road_address),
    tags: tags.length ? tags : ['local', 'recommended'],
    rating: pickNumber(row.rating, row.score, row.reviewScore),
    liveVisitors: pickNumber(row.liveVisitors, row.visitorCount, row.visitors, row.popularityScore),
    occupancyRate: pickNumber(row.occupancyRate, row.congestionRate, row.busyRate),
    imageUrl: pickString(row.imageUrl, row.image_url, row.photoUrl, row.thumbnailUrl) || DEFAULT_IMAGES[index % DEFAULT_IMAGES.length]
  };
}

function normalizeDestinations(payload) {
  const rows = readArray(payload, ['destinations', 'items', 'content', 'results', 'places']);
  return rows.map(normalizeDestination);
}

function normalizeItineraryItem(raw, index = 0) {
  if (typeof raw === 'string') {
    return { time: '', title: raw, place: '', note: '', tags: [] };
  }
  const item = raw || {};
  return {
    time: pickString(item.time, item.timeSlot, item.time_slot, item.startTime, item.hour),
    title: pickString(item.title, item.name, item.destinationName, item.destination_name, item.activity) || `Stop ${index + 1}`,
    place: pickString(item.place, item.location, item.region, item.address),
    note: pickString(item.note, item.notes, item.description, item.reason),
    tags: normalizeTags(item.tags, item.keywords, item.primaryStyle)
  };
}

function normalizeItinerary(raw) {
  const parsed = parseMaybeJson(raw);
  const source = Array.isArray(parsed)
    ? parsed
    : readArray(parsed, ['items', 'days', 'itinerary', 'dailyPlans', 'daily_itinerary', 'schedule']);

  if (!source || !source.length) {
    return [];
  }

  const hasDayContainers = source.some((entry) => entry && typeof entry === 'object' && (entry.items || entry.activities || entry.stops || entry.schedule));
  if (hasDayContainers) {
    return source.map((day, index) => ({
      day: pickNumber(day.day, day.dayNumber, day.day_number) || index + 1,
      title: pickString(day.title, day.summary) || `Day ${index + 1}`,
      items: readArray(day, ['items', 'activities', 'stops', 'schedule']).map(normalizeItineraryItem)
    }));
  }

  const grouped = new Map();
  source.forEach((item, index) => {
    const row = item || {};
    const day = pickNumber(row.day, row.dayNumber, row.day_number) || 1;
    if (!grouped.has(day)) {
      grouped.set(day, []);
    }
    grouped.get(day).push(normalizeItineraryItem(row, index));
  });

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([day, items]) => ({
      day,
      title: `Day ${day}`,
      items
    }));
}

function normalizePlan(raw, index = 0) {
  const plan = raw?.plan || raw?.travelPlan || raw || {};
  const itinerary = normalizeItinerary(plan.itinerary || plan.days || plan.dailyPlans || plan.daily_itinerary || plan.schedule || plan.items);
  const id = pickString(plan.id, plan.planId, plan.plan_id);
  const destinationValue = typeof plan.destination === 'string' ? plan.destination : '';
  const destinationName = pickString(plan.destinationName, plan.destination_name, plan.destination?.name, destinationValue);
  const title = pickString(plan.title, plan.name) || (destinationName ? `${destinationName} trip` : `Travel plan ${index + 1}`);
  return {
    id,
    key: id || `plan-${index}`,
    title,
    destinationName: destinationName || 'Selected destination',
    destinationRegion: pickString(plan.destinationRegion, plan.region, plan.destination?.region),
    summary: pickString(plan.summary, plan.description, plan.overview) || 'Day-by-day local route generated for the selected travel style.',
    startDate: pickString(plan.startDate, plan.start_date),
    days: pickNumber(plan.daysCount, plan.durationDays, plan.duration_days, plan.days) || Math.max(itinerary.length, 1),
    travelers: pickString(plan.travelers, plan.party, plan.travelerType, plan.traveler_type) || 'Flexible',
    pace: pickString(plan.pace, plan.travelPace) || 'Balanced',
    interests: normalizeTags(plan.interests, plan.tags),
    status: pickString(plan.status) || 'Ready',
    createdAt: pickString(plan.createdAt, plan.created_at),
    itinerary
  };
}

function normalizePlans(payload) {
  const rows = readArray(payload, ['plans', 'travelPlans', 'items', 'content', 'results']);
  return rows.map(normalizePlan);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function formatDate(value) {
  if (!value) return 'Flexible dates';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function routeClick(event, to, navigate) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
    return;
  }
  event.preventDefault();
  navigate(to);
}

function useDestinations() {
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usingFallback, setUsingFallback] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await localTripRequest('/api/destinations');
      const normalized = normalizeDestinations(payload);
      setDestinations(normalized.length ? normalized : FALLBACK_DESTINATIONS);
      setUsingFallback(!normalized.length);
    } catch (loadError) {
      setError(loadError.message);
      setDestinations(FALLBACK_DESTINATIONS);
      setUsingFallback(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  return { destinations, loading, error, usingFallback, reload: load };
}

function usePlans(limit) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await localTripRequest('/api/travel-plans');
      const normalized = normalizePlans(payload);
      setPlans(limit ? normalized.slice(0, limit) : normalized);
    } catch (loadError) {
      setError(loadError.message);
      setPlans([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, [limit]);

  return { plans, loading, error, reload: load };
}

function LocalTripNav({ path, navigate }) {
  const items = [
    { label: 'Destinations', to: '/destinations' },
    { label: 'Planner', to: '/planner' },
    { label: 'Plans', to: '/plans' },
    { label: 'Analysis', to: '/analysis' }
  ];

  return (
    <header className="ltNav">
      <div className="ltNavInner">
        <a className="ltBrand" href="/" onClick={(event) => routeClick(event, '/', navigate)}>
          <strong>LT</strong>
          <span>LocalTrip AI</span>
        </a>
        <nav className="ltNavLinks" aria-label="LocalTrip navigation">
          {items.map((item) => (
            <a
              key={item.to}
              href={item.to}
              className={path === item.to || (item.to !== '/' && path.startsWith(`${item.to}/`)) ? 'active' : ''}
              onClick={(event) => routeClick(event, item.to, navigate)}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <a className="ltNavAction" href="/planner" onClick={(event) => routeClick(event, '/planner', navigate)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          New Plan
        </a>
      </div>
    </header>
  );
}

function DestinationCard({ destination, compact = false, navigate }) {
  return (
    <article className={`ltDestinationCard ${compact ? 'compact' : ''}`}>
      <div className="ltDestinationPhoto" style={{ backgroundImage: `url("${destination.imageUrl}")` }}>
        <span>{destination.category}</span>
      </div>
      <div className="ltDestinationBody">
        <div className="ltCardTopline">
          <span>{destination.region}</span>
          {destination.rating ? (
            <strong style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#e11d48" stroke="#e11d48" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
              {destination.rating.toFixed(1)}
            </strong>
          ) : null}
        </div>
        <h3>{destination.name}</h3>
        <p>{destination.summary}</p>
        <div className="ltTagRow">
          {destination.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        {!compact ? (
          <button type="button" className="ltTextButton" onClick={() => navigate(`/planner?destination=${encodeURIComponent(destination.id)}`)} style={{ marginTop: '12px', color: '#0f766e', fontWeight: '700', cursor: 'pointer', border: 'none', background: 'none', padding: '0', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Plan this trip
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        ) : null}
      </div>
    </article>
  );
}

function PlanCard({ plan, navigate }) {
  const content = (
    <>
      <div className="ltCardTopline">
        <span>{plan.destinationRegion || plan.destinationName}</span>
        <strong>{plan.status}</strong>
      </div>
      <h3>{plan.title}</h3>
      <p>{plan.summary}</p>
      <div className="ltPlanMeta">
        <span>{plan.days} days</span>
        <span>{formatDate(plan.startDate)}</span>
        <span>{plan.pace}</span>
      </div>
    </>
  );

  if (!plan.id) {
    return <article className="ltPlanCard">{content}</article>;
  }

  return (
    <a
      className="ltPlanCard"
      href={`/plans/${encodeURIComponent(plan.id)}`}
      onClick={(event) => routeClick(event, `/plans/${encodeURIComponent(plan.id)}`, navigate)}
    >
      {content}
    </a>
  );
}

function InlineNotice({ error, fallback }) {
  if (!error && !fallback) return null;
  return (
    <div className="ltInlineNotice">
      <strong>{fallback ? 'Preview data' : 'Request failed'}</strong>
      <span>{error || 'Connect the LocalTrip API to replace these sample destinations.'}</span>
    </div>
  );
}

function HomePage({ navigate }) {
  const { destinations, loading, error, usingFallback } = useDestinations();
  const { plans, loading: plansLoading } = usePlans(3);
  const topDestinations = destinations.slice(0, 3);

  return (
    <main className="ltPage">
      <section className="ltHero">
        <div className="ltHeroCopy">
          <span className="ltEyebrow">LocalTrip AI</span>
          <h1>Experience Local Like Never Before.</h1>
          <p>Discover hidden gems, plan customized routes, and explore the best of local destinations with our AI-powered travel companion.</p>
          <div className="ltHeroActions">
            <a href="/planner" onClick={(event) => routeClick(event, '/planner', navigate)}>
              Get Started
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '8px' }}>
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </a>
            <a href="/destinations" onClick={(event) => routeClick(event, '/destinations', navigate)}>Browse Places</a>
          </div>
        </div>
        <div className="ltHeroPanel">
          <div>
            <span>Active Destinations</span>
            <strong>{loading ? '-' : formatNumber(destinations.length)}</strong>
          </div>
          <div>
            <span>Community Plans</span>
            <strong>{plansLoading ? '-' : formatNumber(plans.length)}</strong>
          </div>
          <div>
            <span>AI Efficiency</span>
            <strong>100%</strong>
          </div>
        </div>
      </section>

      <InlineNotice error={error} fallback={usingFallback} />

      <section className="ltSectionHeader">
        <div>
          <h2>Featured Destinations</h2>
          <p style={{ color: '#64748b', marginTop: '4px' }}>Hand-picked locations for your next adventure</p>
        </div>
        <a href="/destinations" onClick={(event) => routeClick(event, '/destinations', navigate)} className="ltTextButton" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          View all
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </a>
      </section>
      <div className="ltDestinationGrid">
        {topDestinations.map((destination) => (
          <DestinationCard key={destination.id} destination={destination} navigate={navigate} />
        ))}
      </div>

      <section className="ltSplitSection" style={{ marginTop: '80px', gap: '32px' }}>
        <div className="ltPlannerTeaser">
          <h2>Ready to plan your next journey?</h2>
          <p>Our AI analyzes thousands of data points to create the perfect itinerary tailored just for you.</p>
          <button type="button" onClick={() => navigate('/planner')}>
            Try AI Planner
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '8px' }}>
              <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polyline>
            </svg>
          </button>
        </div>
        <div className="ltRecentPlans">
          <div className="ltSectionHeader compact">
            <div>
              <h2>Recent Itineraries</h2>
            </div>
          </div>
          {plans.length ? plans.map((plan) => <PlanCard key={plan.key} plan={plan} navigate={navigate} />) : (
            <div className="ltEmptyState">No travel plans yet. Be the first!</div>
          )}
        </div>
      </section>
    </main>
  );
}

function DestinationsPage({ navigate }) {
  const { destinations, loading, error, usingFallback, reload } = useDestinations();
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('all');
  const [tag, setTag] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const regions = useMemo(() => {
    const unique = new Set();
    destinations.forEach((destination) => {
      if (destination.region) unique.add(destination.region);
    });
    return ['all', ...Array.from(unique)];
  }, [destinations]);
  const tags = useMemo(() => {
    const unique = new Set();
    destinations.forEach((destination) => destination.tags.forEach((item) => unique.add(item)));
    return ['all', ...Array.from(unique).slice(0, 12)];
  }, [destinations]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return destinations.filter((destination) => {
      const matchesQuery = !keyword || [destination.name, destination.region, destination.summary, destination.category, ...destination.tags]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
      const matchesRegion = region === 'all' || destination.region === region;
      const matchesTag = tag === 'all' || destination.tags.includes(tag);
      return matchesQuery && matchesRegion && matchesTag;
    });
  }, [destinations, query, region, tag]);

  const syncMock = async () => {
    setSyncing(true);
    setSyncError('');
    try {
      await localTripRequest('/api/destinations/sync/mock', { method: 'POST' });
      await reload();
    } catch (syncFailure) {
      setSyncError(syncFailure.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main className="ltPage">
      <section className="ltPageTitle">
        <div>
          <span className="ltEyebrow">Destinations</span>
          <h1>Find a local fit</h1>
        </div>
        <button type="button" className="ltSecondaryButton" onClick={syncMock} disabled={syncing}>
          {syncing ? 'Syncing' : 'Sync mock data'}
        </button>
      </section>

      <InlineNotice error={error} fallback={usingFallback} />
      {syncError ? <div className="ltInlineNotice error"><strong>Sync failed</strong><span>{syncError}</span></div> : null}

      <section className="ltFilterBar">
        <label>
          <span>Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="지역, 장소, 테마 검색" />
        </label>
        <div className="ltSegmented" aria-label="지역 필터">
          {regions.map((item) => (
            <button key={item} type="button" className={region === item ? 'active' : ''} onClick={() => setRegion(item)}>
              {item === 'all' ? '전체 지역' : item}
            </button>
          ))}
        </div>
        <div className="ltSegmented">
          {tags.map((item) => (
            <button key={item} type="button" className={tag === item ? 'active' : ''} onClick={() => setTag(item)}>
              {item === 'all' ? '전체 스타일' : item}
            </button>
          ))}
        </div>
      </section>

      {loading ? <div className="ltEmptyState">Loading destinations.</div> : null}
      {!loading && !filtered.length ? <div className="ltEmptyState">No destinations match the current filters.</div> : null}
      <div className="ltDestinationGrid">
        {filtered.map((destination) => (
          <DestinationCard key={destination.id} destination={destination} navigate={navigate} />
        ))}
      </div>
    </main>
  );
}

function PlannerPage({ path, navigate }) {
  const { destinations, error, usingFallback } = useDestinations();
  const params = new URLSearchParams(path.split('?')[1] || '');
  const initialDestination = params.get('destination') || '';
  const [destinationId, setDestinationId] = useState(initialDestination);
  const [startDate, setStartDate] = useState('');
  const [days, setDays] = useState(3);
  const [travelers, setTravelers] = useState('커플');
  const [transportType, setTransportType] = useState('대중교통');
  const [pace, setPace] = useState('보통');
  const [budget, setBudget] = useState('보통');
  const [exportFormat, setExportFormat] = useState('텍스트');
  const [selectedInterests, setSelectedInterests] = useState(['맛집', '역사']);
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [generatedPlan, setGeneratedPlan] = useState(null);

  const selectedDestination = destinations.find((destination) => destination.id === destinationId) || destinations[0];

  useEffect(() => {
    if (initialDestination) {
      setDestinationId(initialDestination);
    }
  }, [initialDestination]);

  useEffect(() => {
    if (!destinationId && destinations.length) {
      setDestinationId(destinations[0].id);
    }
  }, [destinationId, destinations]);

  const toggleInterest = (interest) => {
    setSelectedInterests((current) => (
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest]
    ));
  };

  const submit = async (event) => {
    event.preventDefault();
    setGenerating(true);
    setGenerateError('');
    setGeneratedPlan(null);
    const payload = {
      region: selectedDestination?.region,
      travelStyle: selectedInterests,
      styles: selectedInterests,
      startDate: startDate || null,
      days: Number(days),
      transportType,
      travelerType: travelers,
      pace,
      budgetLevel: budget,
      exportFormat,
      memo: notes
    };
    try {
      const response = await localTripRequest('/api/travel-plans/generate', { method: 'POST', body: payload });
      const plan = normalizePlan(response);
      setGeneratedPlan(plan);
      if (plan.id) {
        navigate(`/plans/${encodeURIComponent(plan.id)}`);
      }
    } catch (submitError) {
      setGenerateError(submitError.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <main className="ltPage">
      <section className="ltPageTitle">
        <div>
          <span className="ltEyebrow">Planner</span>
          <h1>Build a day-by-day route</h1>
        </div>
      </section>

      <InlineNotice error={error} fallback={usingFallback} />

      <section className="ltPlannerLayout">
        <form className="ltPlannerForm" onSubmit={submit}>
          <label>
            <span>Destination</span>
            <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>{destination.name}</option>
              ))}
            </select>
          </label>
          <div className="ltFormGrid">
            <label>
              <span>Start date</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              <span>Days</span>
              <input type="number" min="1" max="10" value={days} onChange={(event) => setDays(event.target.value)} />
            </label>
          </div>
          <div className="ltFormGrid">
            <label>
              <span>Travelers</span>
              <select value={travelers} onChange={(event) => setTravelers(event.target.value)}>
                <option value="혼자">혼자</option>
                <option value="커플">커플</option>
                <option value="친구">친구</option>
                <option value="가족">가족</option>
              </select>
            </label>
            <label>
              <span>Pace</span>
              <select value={pace} onChange={(event) => setPace(event.target.value)}>
                <option value="여유">여유</option>
                <option value="보통">보통</option>
                <option value="촘촘">촘촘</option>
              </select>
            </label>
          </div>
          <div className="ltFormGrid">
            <label>
              <span>Transport</span>
              <select value={transportType} onChange={(event) => setTransportType(event.target.value)}>
                <option value="대중교통">대중교통</option>
                <option value="자동차">자동차</option>
                <option value="도보">도보</option>
              </select>
            </label>
            <label>
              <span>Export Format</span>
              <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value)}>
                <option value="텍스트">텍스트</option>
                <option value="엑셀">엑셀</option>
                <option value="PDF">PDF</option>
              </select>
            </label>
          </div>
          <label>
            <span>Budget</span>
            <select value={budget} onChange={(event) => setBudget(event.target.value)}>
              <option value="절약">절약</option>
              <option value="보통">보통</option>
              <option value="프리미엄">프리미엄</option>
            </select>
          </label>
          <div className="ltInterestGroup">
            <span>Interests</span>
            <div>
              {INTERESTS.map((interest) => (
                <button
                  key={interest}
                  type="button"
                  className={selectedInterests.includes(interest) ? 'active' : ''}
                  onClick={() => toggleInterest(interest)}
                >
                  {interest}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span>Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Arrival time, mobility needs, must-see stops" />
          </label>
          {generateError ? <div className="ltInlineNotice error"><strong>Generation failed</strong><span>{generateError}</span></div> : null}
          <button type="submit" className="ltPrimaryButton" disabled={generating || !destinationId}>
            {generating ? 'Generating' : 'Generate plan'}
          </button>
        </form>

        <aside className="ltPlannerPreview">
          {selectedDestination ? <DestinationCard destination={selectedDestination} compact navigate={navigate} /> : null}
          {generatedPlan ? (
            <div className="ltGeneratedPreview">
              <h2>{generatedPlan.title}</h2>
              <ItineraryTimeline itinerary={generatedPlan.itinerary} />
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function PlansPage({ navigate }) {
  const { plans, loading, error, reload } = usePlans();

  return (
    <main className="ltPage">
      <section className="ltPageTitle">
        <div>
          <span className="ltEyebrow">Plans</span>
          <h1>Saved itineraries</h1>
        </div>
        <button type="button" className="ltSecondaryButton" onClick={reload}>Refresh</button>
      </section>

      {error ? <div className="ltInlineNotice error"><strong>Request failed</strong><span>{error}</span></div> : null}
      {loading ? <div className="ltEmptyState">Loading travel plans.</div> : null}
      {!loading && !plans.length ? <div className="ltEmptyState">No saved travel plans yet.</div> : null}
      <div className="ltPlansGrid">
        {plans.map((plan) => <PlanCard key={plan.key} plan={plan} navigate={navigate} />)}
      </div>
    </main>
  );
}

function ItineraryTimeline({ itinerary }) {
  if (!itinerary || !itinerary.length) {
    return (
      <div className="ltEmptyState" style={{ marginTop: '24px', padding: '60px' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '16px' }}>
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p>일정 상세 내역이 아직 생성되지 않았거나 불러올 수 없습니다.</p>
      </div>
    );
  }
  return (
    <div className="ltTimeline">
      {itinerary.map((day) => (
        <section className="ltTimelineDay" key={day.day}>
          <div className="ltTimelineDayHeader">
            <span>Day {day.day}</span>
            <h2>{day.title}</h2>
          </div>
          <div className="ltTimelineItems">
            {day.items.map((item, index) => (
              <article className="ltTimelineItem" key={`${day.day}-${item.title}-${index}`}>
                <time>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  {item.time || '유동적'}
                </time>
                <div className="ltTimelineItemContent">
                  <h3>{item.title}</h3>
                  {item.place ? (
                    <span className="ltTimelinePlace">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                      </svg>
                      {item.place}
                    </span>
                  ) : null}
                  {item.note ? <p className="ltTimelineNote">{item.note}</p> : null}
                  {item.tags && item.tags.length ? (
                    <div className="ltTagRow small">
                      {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PlanDetailPage({ planId, navigate }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const payload = await localTripRequest(`/api/travel-plans/${encodeURIComponent(planId)}`);
        if (!cancelled) {
          setPlan(normalizePlan(payload));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
          setPlan(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [planId]);

  return (
    <main className="ltPage">
      <div className="ltPageHeader">
        <button type="button" className="ltBackButton" onClick={() => navigate('/plans')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          목록으로 돌아가기
        </button>
      </div>

      {loading ? <div className="ltEmptyState" style={{ padding: '100px' }}>일정을 불러오는 중입니다...</div> : null}
      {error ? <div className="ltInlineNotice error"><strong>로드 실패</strong><span>{error}</span></div> : null}
      
      {plan ? (
        <div className="ltPlanDetailContainer">
          <section className="ltPlanHero">
            <div className="ltPlanHeroMain">
              <span className="ltEyebrow">{plan.destinationName}</span>
              <h1>{plan.title}</h1>
              <p>{plan.summary}</p>
            </div>
            <div className="ltPlanFacts">
              <div className="ltFactItem">
                <span>기간</span>
                <strong>{plan.days}일</strong>
              </div>
              <div className="ltFactItem">
                <span>출발일</span>
                <strong>{formatDate(plan.startDate)}</strong>
              </div>
              <div className="ltFactItem">
                <span>인원</span>
                <strong>{plan.travelers}</strong>
              </div>
              <div className="ltFactItem">
                <span>속도</span>
                <strong>{plan.pace}</strong>
              </div>
            </div>
          </section>
          
          <div className="ltSectionHeader" style={{ marginTop: '48px', marginBottom: '24px' }}>
            <h2>상세 일정</h2>
          </div>
          <ItineraryTimeline itinerary={plan.itinerary} />
        </div>
      ) : null}
    </main>
  );
}

function NotFoundPage({ navigate }) {
  return (
    <main className="ltPage">
      <section className="ltEmptyState large">
        <h1>Page not found</h1>
        <button type="button" className="ltPrimaryButton" onClick={() => navigate('/')}>Go home</button>
      </section>
    </main>
  );
}

export default function LocalTripApp({ path, navigate }) {
  useEffect(() => {
    document.title = 'LocalTrip AI';
  }, [path]);

  const normalizedPath = path || '/';
  const cleanPath = normalizedPath.split('?')[0];
  let page;
  if (cleanPath === '/') {
    page = <HomePage navigate={navigate} />;
  } else if (cleanPath === '/destinations') {
    page = <DestinationsPage navigate={navigate} />;
  } else if (cleanPath === '/planner') {
    page = <PlannerPage path={normalizedPath} navigate={navigate} />;
  } else if (cleanPath === '/plans') {
    page = <PlansPage navigate={navigate} />;
  } else if (cleanPath.startsWith('/plans/')) {
    page = <PlanDetailPage planId={decodeURIComponent(cleanPath.replace('/plans/', ''))} navigate={navigate} />;
  } else {
    page = <NotFoundPage navigate={navigate} />;
  }

  return (
    <div className="ltShell">
      <LocalTripNav path={cleanPath} navigate={navigate} />
      {page}
      <footer className="ltFooter">
        <span>LocalTrip AI</span>
        <a href="/analysis" onClick={(event) => routeClick(event, '/analysis', navigate)}>Jupiter analysis workspace</a>
      </footer>
    </div>
  );
}
