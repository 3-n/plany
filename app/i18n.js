// UI strings. Polish is the default; ?lang=en (remembered in this browser) switches to English.
// Static HTML is marked with data-i18n (replaces the element's first text node, so labels keep
// their inputs), data-i18n-html, data-i18n-title and data-i18n-aria.

export const LANGS = ['pl', 'en'];

function pickLang() {
  const asked = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(asked)) {
    try { localStorage.setItem('lang', asked); } catch { /* private mode */ }
    return asked;
  }
  try { const saved = localStorage.getItem('lang'); if (LANGS.includes(saved)) return saved; } catch { /* private mode */ }
  return 'pl';
}

export const lang = pickLang();

// Polish plural: 1 punkt, 2–4 punkty, 5+ punktów (and 12–14 punktów).
const plPlural = (n, one, few, many) => {
  if (n === 1) return one;
  const d = n % 10, dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? few : many;
};

const STRINGS = {
  pl: {
    appName: 'Plany',
    langSwitch: 'EN',
    langSwitchTitle: 'Switch to English',
    paneImage: 'Obraz planu',
    paneMap: 'Mapa',
    tagPlan: 'Plan',
    tagMap: 'Mapa',
    copyLink: 'Kopiuj link',
    copyLinkTitle: 'Skopiuj link do dokładnie tego widoku',
    hidePlans: 'Ukryj plany ▾',
    showPlans: (n) => `Plany (${n}) ▴`,
    planOpacity: 'Krycie planów',
    layerOpacity: 'Krycie planu',
    blending: 'Tryb mieszania',
    blendingTitle: 'Jak plan jest rysowany na zdjęciu',
    mixed: 'Różne',
    modeMultiply: 'Mnożenie (białe = przezroczyste)',
    modeNormal: 'Normalny',
    modeKnockout: 'Białe → przezroczyste',
    modeKnockoutInvert: 'Białe → przezroczyste, odwrócone',
    planSet: 'Zestaw planów',
    newSet: 'Nowy zestaw',
    setTitle: 'Tytuł (widoczny na opublikowanej stronie)',
    setDesc: 'Opis (do podglądu linku)',
    addPlan: '+ Dodaj plan (PDF / obraz)',
    tips: 'Skróty i wskazówki',
    tipToggle: '<kbd>T</kbd> włącza i wyłącza zaznaczony plan – szybki sposób na porównanie ze stanem obecnym.',
    tipMeasure: '<kbd>M</kbd> mierzy odległości; dwuklik kończy linię, <kbd>Esc</kbd> czyści pomiar.',
    tipBlend: 'Tryb <b>Mnożenie</b> sprawia, że biały papier staje się przezroczysty. <b>Białe → przezroczyste</b> działa też na ciemnych zdjęciach.',
    tipBasemap: 'Przełącznik podkładów (lewy górny róg) ma fotoplan Warszawy 2021 (5&nbsp;cm) i działki ewidencyjne, które pomagają sprawdzić dopasowanie.',
    edDone: '← Gotowe',
    edZoom: 'Przybliż do planu',
    name: 'Nazwa',
    clickMode: 'Tryb klikania',
    modePoints: 'Punkty',
    modeMask: 'Maska przycięcia',
    modePan: 'Tylko przesuwanie',
    transform: 'Transformacja',
    methodAuto: 'Automatyczna',
    methodSimilarity: 'Przez podobieństwo (przesunięcie, obrót, skala)',
    methodAffine: 'Afiniczna (+ rozciągnięcie/pochylenie, ≥3 pkt)',
    methodProjective: 'Rzutowa (zdjęcie planu, ≥4 pkt)',
    methodName: { similarity: 'przez podobieństwo', affine: 'afiniczna', projective: 'rzutowa' },
    colUse: 'Użyj',
    colError: 'Błąd',
    colErrorTitle: 'Odległość między miejscem, w którym postawiono punkt, a miejscem, w które przenosi go dopasowana transformacja',
    colStatus: 'Stan',
    coordsTitle: 'Punkt <b id="ed-coords-id"></b>: wpisz współrzędne z siatki planu',
    northing: 'X (północna)',
    easting: 'Y (wschodnia)',
    set: 'Ustaw',
    maskHelp: 'Klikaj wokół części rysunku, którą chcesz zachować. Kliknij pierwszy wierzchołek lub naciśnij <kbd>Enter</kbd>, aby zamknąć; <kbd>Esc</kbd> anuluje.',
    maskFinish: 'Zakończ maskę',
    maskClear: 'Usuń maskę',
    overlayOpacity: 'Krycie nakładki',
    addTitle: 'Dodaj plan',
    file: 'Plik',
    page: 'Strona',
    resolution: 'Rozdzielczość',
    maxSize: 'Maks. rozmiar',
    storeAs: 'Zapisz jako',
    jpeg: 'JPEG (skany)',
    png: 'PNG (ostre linie)',
    cancel: 'Anuluj',
    addGo: 'Dodaj i georeferuj',

    saving: 'Zapisywanie…',
    saved: 'Zapisano',
    notSaved: (m) => `Nie zapisano: ${m}`,
    uploadFailed: (m) => `Wysyłanie nie powiodło się: ${m}`,
    couldNotLoad: (f) => `Nie udało się wczytać ${f}`,
    measure: 'Mierz odległość (M)',
    basemapOrto: 'Ortofotomapa – Geoportal (najnowsza)',
    basemapWaw: 'Warszawa – fotoplan 2021, 5 cm',
    overlayParcels: 'Działki ewidencyjne',
    overlayBuildings: 'Budynki ewidencyjne',
    points: (n) => `${n} ${plPlural(n, 'punkt', 'punkty', 'punktów')}`,
    needsTwo: (n) => `${n} ${plPlural(n, 'punkt', 'punkty', 'punktów')}, potrzeba co najmniej 2`,
    notGeoreferenced: 'Jeszcze bez georeferencji',
    exactFit: 'dokładne dopasowanie',
    showHide: 'Pokaż/ukryj (T)',
    zoomTo: 'Przybliż',
    georeference: 'Georeferencja',
    moveUp: 'Rysuj nad poprzednim planem',
    moveDown: 'Rysuj pod następnym planem',
    delete: 'Usuń',
    emptyEdit: 'Nie ma jeszcze planów. Dodaj PDF lub skan, a potem dopasuj kilka punktów między planem a zdjęciem lotniczym.',
    emptyView: 'Nie opublikowano tu jeszcze żadnych planów.',
    original: (ext, size) => `Oryginał (${ext}${size}) ↓`,
    confirmDelete: (n) => `Usunąć „${n}” wraz z plikami?`,
    newSetPrompt: 'Krótka nazwa nowego zestawu, używana w linku (małe litery, cyfry, myślniki):',
    linkCopied: 'Skopiowano link',
    copyThisLink: 'Skopiuj ten link:',
    readingPdf: 'Wczytywanie PDF…',
    pageOf: (i, n) => `${i} z ${n}`,
    allPages: 'Wszystkie strony (każda jako osobny plan)',
    cantOpen: (m) => `Nie można otworzyć pliku: ${m}`,
    pageInfo: (w, h, pw, ph, dpi) => `Strona ${w} × ${h} mm → ${pw} × ${ph} px (${dpi} dpi)`,
    tooLarge: 'Obraz jest za duży dla tej przeglądarki; wybierz mniejszy maks. rozmiar',
    savingOriginal: 'Zapisywanie oryginalnego pliku…',
    renderingPage: (n) => `Renderowanie strony ${n}…`,
    preparingImage: 'Przygotowywanie obrazu…',
    savingMb: (mb) => `Zapisywanie ${mb} MB…`,
    pageSuffix: (n) => `s. ${n}`,
    planScale: (s) => ` · skala planu ≈ <b>1:${s}</b>`,
    exactFitHint: 'dokładne dopasowanie, dodaj punkt, aby sprawdzić błąd',
    rmsError: (m) => `błąd RMS <b>${m}</b>`,
    fitInfo: (method, n, acc, px, scale) => `Transformacja <b>${method}</b>, ${n} ${plPlural(n, 'punkt', 'punkty', 'punktów')} · ${acc} · 1 px = ${px}${scale}`,
    placeTwo: 'Postaw co najmniej 2 pary punktów, aby zobaczyć plan na mapie.',
    stTyped: 'wpisane współrzędne',
    stPlaced: 'postawiony',
    stNeedsMap: 'brak punktu na mapie',
    stNeedsPlan: 'brak punktu na planie',
    useInFit: 'Uwzględnij ten punkt w dopasowaniu',
    deletePoint: 'Usuń punkt',
    crsUnknown: 'PL-2000 (strefa z Y) lub PUWG-1992',
    hintMask: 'Maska przycięcia: klikaj na planie (po lewej), aby obrysować obszar do pokazania. Tabliczki i legendy zwykle można pominąć.',
    hintPan: 'Tylko przesuwanie: kliknięcia nic nie robią, możesz się swobodnie rozglądać.',
    hintNeedMap: (id) => `Punkt ${id}: teraz kliknij to samo miejsce na mapie (po prawej) albo wpisz jego współrzędne poniżej. Esc anuluje.`,
    hintNeedPlan: (id) => `Punkt ${id}: teraz kliknij to samo miejsce na planie (po lewej). Esc anuluje.`,
    hintStart: (n) => `Kliknij wyraźny punkt na planie (po lewej), a potem to samo miejsce na mapie (po prawej). Dobrze sprawdzają się narożniki budynków i krawężników, studzienki albo krzyże siatki. Na razie ${n}/2 punktów.`,
    hintMore: 'Plan jest już na mapie. Dodaj 1–2 punkty daleko od siebie, najlepiej przy narożnikach arkusza, aby zmierzyć błąd. Przeciągaj znaczniki, by je poprawić.',
    hintDone: 'Punkty z czerwonym błędem są pewnie źle postawione: przeciągnij je albo odznacz. Przełącz na „Tylko przesuwanie”, aby się rozejrzeć.',
    outsidePoland: (code) => `Te współrzędne wypadają poza Polską (${code}). W polskiej notacji X to współrzędna północna, a Y wschodnia. Czy nie są zamienione?`,
  },
  en: {
    appName: 'Plan Overlay',
    langSwitch: 'PL',
    langSwitchTitle: 'Przełącz na polski',
    paneImage: 'Plan image',
    paneMap: 'Map',
    tagPlan: 'Plan',
    tagMap: 'Map',
    copyLink: 'Copy link',
    copyLinkTitle: 'Copy a link to exactly this view',
    hidePlans: 'Hide plans ▾',
    showPlans: (n) => `Plans (${n}) ▴`,
    planOpacity: 'Plan opacity',
    layerOpacity: 'Plan opacity',
    blending: 'Blending',
    blendingTitle: 'How the plan is drawn over the photo',
    mixed: 'Mixed',
    modeMultiply: 'Multiply (white = see-through)',
    modeNormal: 'Normal',
    modeKnockout: 'White → transparent',
    modeKnockoutInvert: 'White → transparent, inverted',
    planSet: 'Plan set',
    newSet: 'New set',
    setTitle: 'Title (shown on the published page)',
    setDesc: 'Description (for link previews)',
    addPlan: '+ Add plan (PDF / image)',
    tips: 'Keys & tips',
    tipToggle: "<kbd>T</kbd> toggles the selected plan on/off, a fast way to compare with what's there now.",
    tipMeasure: '<kbd>M</kbd> measures distances; double-click ends a line, <kbd>Esc</kbd> clears.',
    tipBlend: '<b>Multiply</b> blending makes white paper see-through. <b>White → transparent</b> also works on dark photos.',
    tipBasemap: 'The basemap switcher (top-left) has the Warsaw 2021 5&nbsp;cm photomap and cadastral parcels, which help to check alignment.',
    edDone: '← Done',
    edZoom: 'Zoom to plan',
    name: 'Name',
    clickMode: 'Click mode',
    modePoints: 'Points',
    modeMask: 'Crop mask',
    modePan: 'Pan only',
    transform: 'Transform',
    methodAuto: 'Auto',
    methodSimilarity: 'Similarity (shift, rotate, scale)',
    methodAffine: 'Affine (+ stretch/skew, ≥3 pts)',
    methodProjective: 'Projective (photo of a plan, ≥4 pts)',
    methodName: { similarity: 'similarity', affine: 'affine', projective: 'projective' },
    colUse: 'Use',
    colError: 'Error',
    colErrorTitle: 'Distance between where you put the point and where the fitted transform puts it',
    colStatus: 'Status',
    coordsTitle: 'Point <b id="ed-coords-id"></b>: type coordinates from the plan\'s grid',
    northing: 'X (northing)',
    easting: 'Y (easting)',
    set: 'Set',
    maskHelp: 'Click around the part of the drawing to keep. Click the first vertex or press <kbd>Enter</kbd> to close, <kbd>Esc</kbd> cancels.',
    maskFinish: 'Finish mask',
    maskClear: 'Remove mask',
    overlayOpacity: 'Overlay opacity',
    addTitle: 'Add a plan',
    file: 'File',
    page: 'Page',
    resolution: 'Resolution',
    maxSize: 'Max size',
    storeAs: 'Store as',
    jpeg: 'JPEG (scans)',
    png: 'PNG (crisp lines)',
    cancel: 'Cancel',
    addGo: 'Add & georeference',

    saving: 'Saving…',
    saved: 'Saved',
    notSaved: (m) => `Not saved: ${m}`,
    uploadFailed: (m) => `Upload failed: ${m}`,
    couldNotLoad: (f) => `Could not load ${f}`,
    measure: 'Measure distance (M)',
    basemapOrto: 'Ortofotomapa – Geoportal (newest)',
    basemapWaw: 'Warsaw – fotoplan 2021, 5 cm',
    overlayParcels: 'Cadastral parcels',
    overlayBuildings: 'Cadastral buildings',
    points: (n) => `${n} point${n === 1 ? '' : 's'}`,
    needsTwo: (n) => `${n} point${n === 1 ? '' : 's'}, needs at least 2`,
    notGeoreferenced: 'Not georeferenced yet',
    exactFit: 'exact fit',
    showHide: 'Show/hide (T)',
    zoomTo: 'Zoom to',
    georeference: 'Georeference',
    moveUp: 'Draw above the plan before it',
    moveDown: 'Draw below the plan after it',
    delete: 'Delete',
    emptyEdit: 'No plans yet. Add a PDF or a scan, then match a few points between the plan and the aerial photo.',
    emptyView: 'No plans published here yet.',
    original: (ext, size) => `Original (${ext}${size}) ↓`,
    confirmDelete: (n) => `Delete "${n}" and its files?`,
    newSetPrompt: 'Short name for the new set, used in its link (lowercase, digits, dashes):',
    linkCopied: 'Link copied',
    copyThisLink: 'Copy this link:',
    readingPdf: 'Reading PDF…',
    pageOf: (i, n) => `${i} of ${n}`,
    allPages: 'All pages (one plan each)',
    cantOpen: (m) => `Can't open this file: ${m}`,
    pageInfo: (w, h, pw, ph, dpi) => `Page ${w} × ${h} mm → ${pw} × ${ph} px (${dpi} dpi)`,
    tooLarge: 'Image too large for this browser; try a smaller max size',
    savingOriginal: 'Saving original file…',
    renderingPage: (n) => `Rendering page ${n}…`,
    preparingImage: 'Preparing image…',
    savingMb: (mb) => `Saving ${mb} MB…`,
    pageSuffix: (n) => `p. ${n}`,
    planScale: (s) => ` · plan scale ≈ <b>1:${s}</b>`,
    exactFitHint: 'exact fit, add a point to check the error',
    rmsError: (m) => `RMS error <b>${m}</b>`,
    fitInfo: (method, n, acc, px, scale) => `Using <b>${method}</b> with ${n} points · ${acc} · 1 px = ${px}${scale}`,
    placeTwo: 'Place at least 2 point pairs to see the plan on the map.',
    stTyped: 'typed coords',
    stPlaced: 'placed',
    stNeedsMap: 'needs map point',
    stNeedsPlan: 'needs plan point',
    useInFit: 'Use this point in the fit',
    deletePoint: 'Delete point',
    crsUnknown: 'PL-2000 (zone from Y) or PUWG-1992',
    hintMask: 'Crop mask: click on the plan (left) to outline the area to show. Title blocks and legends usually go.',
    hintPan: 'Pan only: clicks do nothing, so you can look around.',
    hintNeedMap: (id) => `Point ${id}: now click the same spot on the map (right), or type its coordinates below. Esc cancels.`,
    hintNeedPlan: (id) => `Point ${id}: now click the same spot on the plan (left). Esc cancels.`,
    hintStart: (n) => `Click a sharp spot on the plan (left), then the same spot on the map (right). Building corners, kerb corners, manholes or grid crosses work well. ${n}/2 points so far.`,
    hintMore: 'The plan is on the map. Add 1–2 more points far apart, ideally near the sheet corners, to measure the error. Drag markers to refine them.',
    hintDone: 'Points with a red error are probably misplaced: drag them or untick them. Switch to Pan only to look around.',
    outsidePoland: (code) => `These coordinates land outside Poland (${code}). In Polish notation X is the northing and Y the easting. Did you swap them?`,
  },
};

const dict = STRINGS[lang];

export function t(key, ...args) {
  const v = dict[key] ?? STRINGS.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  for (const e of root.querySelectorAll('[data-i18n]')) {
    const text = t(e.dataset.i18n);
    const node = [...e.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (node) node.textContent = node.textContent.replace(/\S.*\S|\S/s, text);
    else e.prepend(text);
  }
  for (const e of root.querySelectorAll('[data-i18n-html]')) e.innerHTML = t(e.dataset.i18nHtml);
  for (const e of root.querySelectorAll('[data-i18n-title]')) e.title = t(e.dataset.i18nTitle);
  for (const e of root.querySelectorAll('[data-i18n-aria]')) e.setAttribute('aria-label', t(e.dataset.i18nAria));
}

// Reload in the other language, keeping the view (hash) and the set.
export function switchLang() {
  const next = lang === 'pl' ? 'en' : 'pl';
  const q = new URLSearchParams(location.search);
  let stored = false;
  try { localStorage.setItem('lang', next); stored = true; } catch { /* private mode */ }
  if (stored) q.delete('lang'); else q.set('lang', next);
  const qs = q.toString();
  // Assigning a URL that differs only in its hash would not reload, so replace and reload.
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  location.reload();
}
