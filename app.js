const LEVELS = {
  BG: { label: "Beginner", description: "มือใหม่ กำลังฝึกพื้นฐาน" },
  N: { label: "Normal", description: "เล่นทั่วไป ตีโต้และลงเกมได้" },
  S: { label: "Strong", description: "มือแข็ง แข่งขันและคุมเกมได้" },
};

const CLUB_VALID_UNTIL = "30 ก.ย. 2570";
const routeParams = new URLSearchParams(window.location.search);
const routeSegments = window.location.pathname.split("/").filter(Boolean);
const pathView = [...routeSegments].reverse().map((segment) => ({ board: "board", player: "mobile", admin: "admin" })[segment]).find(Boolean);
const requestedView = routeParams.get("view") || pathView;
const requestedAdminTab = routeParams.get("tab");
const requestedBoardQueueCount = Number(routeParams.get("queues"));

const state = {
  view: ["board", "mobile", "admin"].includes(requestedView) ? requestedView : "board",
  adminTab: ["overview", "balls", "shop", "payments", "people", "masters"].includes(requestedAdminTab) ? requestedAdminTab : "overview",
  ballAdminMode: "list",
  shopAdminMode: "list",
  dashboardPeriod: "day",
  boardQueueCount: [10, 20].includes(requestedBoardQueueCount) ? requestedBoardQueueCount : 10,
  boardAutoCycle: ![10, 20].includes(requestedBoardQueueCount),
  adminUnlocked: sessionStorage.getItem("uthai-admin-unlocked") === "true",
  currentPlayerId: null,
  selectedPlayers: [],
  lastSync: new Date(),
  members: [],
  courts: [
    { id: 1, name: "สนาม 1", active: true },
    { id: 2, name: "สนาม 2", active: true },
    { id: 3, name: "สนาม 3", active: true },
    { id: 4, name: "สนาม 4", active: true },
  ],
  queues: [],
  ballRounds: [],
  shuttles: [
    { id: 1, brand: "RSL", model: "Classic", price: 90, active: true },
    { id: 2, brand: "Victor", model: "Master No. 1", price: 105, active: true },
    { id: 3, brand: "Yonex", model: "Aerosensa 30", price: 125, active: true },
  ],
  products: [
    { id: 1, name: "น้ำเปล่า", category: "drink", price: 10, active: true },
    { id: 2, name: "เกลือแร่", category: "drink", price: 20, active: true },
    { id: 3, name: "กริปพันด้าม", category: "equipment", price: 60, active: true },
    { id: 4, name: "ถุงเท้าแบด", category: "equipment", price: 120, active: true },
  ],
  purchases: [],
  payments: {},
  paymentProofs: {},
  settings: { guestEntryFee: 20, annualMemberFee: 0, systemChargeMode: "per_shuttle", systemFeePerShuttle: 5, monthlySystemFee: 1500 },
  adminFilters: {
    balls: { date: "today", query: "", sort: "newest" },
    shop: { date: "today", query: "", sort: "newest" },
    payments: { date: "today", query: "", sort: "amount_desc" },
    people: { query: "", sort: "name_asc" },
  },
  analytics: { revenueBeforeToday: { month: 0, year: 0 }, lastSixDays: [0, 0, 0, 0, 0, 0] },
};

const SHARED_STATE_KEYS = [
  "members", "courts", "queues", "ballRounds", "shuttles", "products",
  "purchases", "payments", "paymentProofs", "settings", "analytics",
];
const realtime = {
  socket: null,
  connected: false,
  hydrated: false,
  applying: false,
  clients: 0,
  revision: 0,
  lastSnapshot: "",
  retryTimer: null,
};

function sharedStateSnapshot() {
  return {
    levels: { ...LEVELS },
    state: Object.fromEntries(SHARED_STATE_KEYS.map((key) => [key, state[key]])),
  };
}

function setConnectionStatus(status, label) {
  const indicator = document.querySelector("[data-realtime-status]");
  if (indicator) {
    indicator.classList.toggle("offline", status === "offline");
    indicator.classList.toggle("syncing", status === "syncing");
    indicator.innerHTML = `<i></i> ${label}`;
  }
  const boardIndicator = document.querySelector("[data-board-realtime-status]");
  if (boardIndicator) boardIndicator.textContent = status === "online" ? `● WEBSOCKET · ${realtime.clients} จอเชื่อมต่อ` : `● ${label}`;
}

function applyRealtimeSnapshot(snapshot, revision = 0) {
  if (!snapshot?.state || !snapshot.levels) return;
  realtime.applying = true;
  SHARED_STATE_KEYS.forEach((key) => {
    if (key in snapshot.state) state[key] = snapshot.state[key];
  });
  Object.keys(LEVELS).forEach((key) => delete LEVELS[key]);
  Object.assign(LEVELS, snapshot.levels);
  realtime.revision = revision;
  realtime.hydrated = true;
  realtime.lastSnapshot = JSON.stringify(sharedStateSnapshot());
  realtime.applying = false;
  state.lastSync = new Date();
  render();
}

function queueRealtimeSync() {
  if (!realtime.hydrated || realtime.applying || realtime.socket?.readyState !== WebSocket.OPEN) return;
  const snapshot = sharedStateSnapshot();
  const serialized = JSON.stringify(snapshot);
  if (serialized === realtime.lastSnapshot) return;
  realtime.lastSnapshot = serialized;
  realtime.socket.send(JSON.stringify({ type: "state:update", baseRevision: realtime.revision, data: snapshot }));
}

function connectRealtime() {
  if (!["http:", "https:"].includes(window.location.protocol)) {
    setConnectionStatus("offline", "LOCAL");
    return;
  }
  if ([WebSocket.CONNECTING, WebSocket.OPEN].includes(realtime.socket?.readyState)) return;
  clearTimeout(realtime.retryTimer);
  setConnectionStatus("syncing", "กำลังเชื่อมต่อ");
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  realtime.socket = socket;

  socket.addEventListener("open", () => {
    realtime.connected = true;
    setConnectionStatus("syncing", "กำลังซิงก์");
  });
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === "state:bootstrap-request") {
        const snapshot = sharedStateSnapshot();
        realtime.hydrated = true;
        realtime.lastSnapshot = JSON.stringify(snapshot);
        socket.send(JSON.stringify({ type: "state:bootstrap", data: snapshot }));
      }
      if (message.type === "state:snapshot") applyRealtimeSnapshot(message.data, message.revision);
      if (message.type === "presence") {
        realtime.clients = message.clients;
        setConnectionStatus("online", `LIVE · ${message.clients} จอ`);
      }
      if (message.type === "error") showToast(`ซิงก์ไม่สำเร็จ: ${message.message}`);
    } catch (error) {
      console.error("Realtime message error", error);
    }
  });
  socket.addEventListener("close", () => {
    realtime.connected = false;
    realtime.hydrated = false;
    setConnectionStatus("offline", "OFFLINE");
    realtime.retryTimer = setTimeout(connectRealtime, 2_000);
  });
  socket.addEventListener("error", () => socket.close());
}

const app = document.querySelector("#app");
const dialog = document.querySelector("#appDialog");
const dialogContent = document.querySelector("#dialogContent");
const money = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function member(id) { return state.members.find((item) => item.id === id); }
function product(id) { return state.products.find((item) => item.id === id); }
function shuttle(id) { return state.shuttles.find((item) => item.id === id); }
function shuttleLabel(item) { return item ? `${item.brand} ${item.model}`.trim() : "ไม่พบยี่ห้อ"; }
function productCategoryName(item) { return item.category === "drink" ? "น้ำดื่ม" : "อุปกรณ์"; }
function queuePlayers(queue) { return queue.playerIds.map(member); }
function checkedInMembers() { return state.members.filter((item) => item.checkedIn); }
function visitedToday(person) { return person.visitedToday ?? person.checkedIn; }
function canPlay(person) { return Boolean(person?.checkedIn) && !person.previousDue; }
function membershipName(person) { return person.membership === "club" ? "สมาชิกชมรม" : "บุคคลภายนอก"; }
function membershipDetail(person) { return person.membership === "club" ? `รายปีถึง ${CLUB_VALID_UNTIL}` : `ค่าเข้า ฿${state.settings.guestEntryFee}/วัน`; }
function initialsAvatar(person, extra = "") { return `<span class="avatar ${extra}">${person.initials}</span>`; }
function getPlayingQueue(courtId) { return state.queues.find((item) => item.status === "playing" && item.courtId === courtId); }
function waitingQueues() { return state.queues.filter((item) => item.status === "waiting"); }
function activePlayingQueues() { return state.queues.filter((item) => item.status === "playing"); }
function activeQueues() { return state.queues.filter((item) => item.status === "waiting" || item.status === "playing"); }
function availableMembers() {
  const busyIds = new Set(activeQueues().flatMap((queue) => queue.playerIds));
  return checkedInMembers().filter((person) => !person.previousDue && !busyIds.has(person.id));
}
function nextQueueCode() { return `Q${String(Math.max(0, ...state.queues.map((item) => item.id)) + 1).padStart(2, "0")}`; }
function formatMoney(value) { return money.format(value); }
function minutesSince(timestamp) { return Math.max(0, Math.floor((Date.now() - timestamp) / 60000)); }
function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
function selectedDateKey(value) { return value === "today" ? localDateKey() : value; }
function matchesAdminDate(timestamp, value) { return !value || localDateKey(timestamp) === selectedDateKey(value); }
function localDateTimeValue(timestamp) {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function systemFeeLabel() { return state.settings.systemChargeMode === "per_shuttle" ? `ลูกละ ฿${formatMoney(state.settings.systemFeePerShuttle)}` : `เหมาจ่าย ฿${formatMoney(state.settings.monthlySystemFee)}/เดือน`; }
function systemFeeForRound(balls) { return state.settings.systemChargeMode === "per_shuttle" ? balls * state.settings.systemFeePerShuttle : 0; }

function personNames(queue) {
  const players = queuePlayers(queue);
  return `${players[0].name} · ${players[1].name} / ${players[2].name} · ${players[3].name}`;
}

function setView(view) {
  state.view = view;
  document.querySelectorAll("[data-route-link]").forEach((link) => link.classList.toggle("active", link.dataset.routeLink === view));
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => app.focus({ preventScroll: true }), 0);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast success";
  toast.textContent = message;
  document.querySelector("#toastRegion").appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}

function openDialog(content) {
  dialogContent.innerHTML = content;
  dialog.showModal();
}

function closeDialog() { dialog.close(); }

function renderClock() {
  const clock = document.querySelector("#clockTime");
  const date = document.querySelector("#clockDate");
  if (clock) clock.textContent = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (date) date.textContent = new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  document.querySelectorAll("[data-game-clock]").forEach((el) => {
    const queue = state.queues.find((item) => item.id === Number(el.dataset.gameClock));
    if (queue) el.textContent = `${minutesSince(queue.startedAt)} นาที`;
  });
}

function boardView() {
  const courts = state.courts.filter((court) => court.active);
  const queues = activeQueues().slice(0, realtime.connected ? 20 : state.boardQueueCount);
  const waiting = queues.filter((queue) => queue.status === "waiting");
  const queuedPlayerIds = new Set(activeQueues().flatMap((queue) => queue.playerIds));
  const available = checkedInMembers().filter((person) => !queuedPlayerIds.has(person.id));
  const checkedInCount = checkedInMembers().length;
  const queueSlotCount = queues.length <= 10 ? 10 : 20;
  const queuesPerColumn = queueSlotCount / 2;
  const queueSlots = Array.from({ length: queueSlotCount }, (_, index) => tvQueueSlot(index + 1, queues[index]));
  return `
    <section class="page-enter tv-board density-${queues.length} ${queueSlotCount === 10 ? "queue-layout-compact" : "queue-layout-peak"}">
      <div class="page-heading">
        <div><p class="eyebrow">สนามแบดมินตันอุทัยธานี</p><h1>บอร์ดลงคิว</h1><p>จอทีวีสำหรับดูสถานะทั้งหมด · จัดการคิวผ่านมือถือหรือหน้าผู้ดูแล</p></div>
        <div class="clock"><span class="clock-time" id="clockTime"></span><span class="clock-date" id="clockDate"></span><span class="tv-refresh" data-board-realtime-status>${realtime.connected ? `● WEBSOCKET · ${realtime.clients} จอเชื่อมต่อ` : `● LOCAL · ${state.boardAutoCycle ? `ตรวจข้อมูลอีกครั้งใน` : `แสดง ${queues.length} คิว · ตรวจข้อมูลใน`} <b id="syncCount">15</b> วิ`}</span></div>
      </div>
      <div class="tv-load-status"><span>QUEUE LOAD</span><strong>${queues.length} คิว</strong><small>${queues.length === 20 ? "ช่วงพีก · ใช้เต็มความจุ" : "ช่วงปกติ · เหลือช่องรองรับอีก 10 คิว"}</small></div>
      <div class="metric-row">
        <div class="metric"><span>เช็คอินแล้ว</span><strong>${checkedInCount}<em> คน</em></strong></div>
        <div class="metric highlight"><span>ว่าง ไม่มีคิว</span><strong>${available.length}<em> คน</em></strong></div>
        <div class="metric"><span>คิวรอ</span><strong>${waiting.length}<em> คิว</em></strong></div>
        <div class="metric"><span>สนามว่าง</span><strong>${courts.filter((court) => !getPlayingQueue(court.id)).length}<em> สนาม</em></strong></div>
      </div>
      <div class="tv-board-grid">
        <section class="panel tv-queue-panel">
          <div class="panel-header"><div><h2>ลำดับคิว 1–${queueSlotCount}</h2><p>ปรับตารางตามจำนวนคิว · เรียงตามเวลาลงคิว · จอนี้แสดงผลอย่างเดียว</p></div><span class="badge warning">รอ ${waiting.length} คิว</span></div>
          <div class="tv-queue-columns"><div>${queueSlots.slice(0, queuesPerColumn).join("")}</div><div>${queueSlots.slice(queuesPerColumn).join("")}</div></div>
        </section>
        <aside class="tv-board-side">
          <section class="panel tv-court-panel">
            <div class="panel-header"><div><h2>สถานะ 4 สนาม</h2><p>กำลังเล่นและเวลาล่าสุด</p></div></div>
            <div class="tv-court-list">${courts.map(tvCourtRow).join("")}</div>
          </section>
          <section class="panel tv-available-panel">
            <div class="panel-header"><div><h2>คนว่าง · ไม่มีคิว</h2><p>รายชื่อที่จับทีมเพิ่มได้ตอนนี้</p></div><span class="available-signal"><i></i>${available.length} คน</span></div>
            <div class="tv-available-list">${available.map(tvAvailablePerson).join("") || `<div class="empty-state">ตอนนี้ไม่มีคนว่าง</div>`}</div>
          </section>
        </aside>
      </div>
    </section>`;
}

function tvQueueSlot(position, queue) {
  if (!queue) return `<div class="tv-queue-slot empty"><span class="tv-queue-index">${position}</span><span>—</span><small>ว่าง</small></div>`;
  const players = queuePlayers(queue);
  const playing = queue.status === "playing";
  return `<div class="tv-queue-slot ${playing ? "playing" : "waiting"}"><span class="tv-queue-index">${position}</span><div><strong>${players.map((person) => person.name).join(" · ")}</strong><small>${queue.code} · มือ ${players.map((person) => person.level).join("/")}</small></div><span class="tv-queue-status">${playing ? `สนาม ${queue.courtId}` : `รอ ${minutesSince(queue.createdAt)} นาที`}</span></div>`;
}

function tvCourtRow(court) {
  const queue = getPlayingQueue(court.id);
  if (!queue) return `<div class="tv-court-row open"><span class="tv-court-number">${court.id}</span><div><strong>${court.name}</strong><small>พร้อมรับคิวถัดไป</small></div><span class="status-pill">ว่าง</span></div>`;
  const players = queuePlayers(queue);
  return `<div class="tv-court-row playing"><span class="tv-court-number">${court.id}</span><div><strong>${players.map((person) => person.name).join(" · ")}</strong><small>${court.name} · ${queue.code}</small></div><span class="game-time">● <span data-game-clock="${queue.id}">${minutesSince(queue.startedAt)} นาที</span></span></div>`;
}

function tvAvailablePerson(person) {
  return `<div class="tv-available-person">${initialsAvatar(person)}<div><strong>${person.name}</strong><small>${membershipName(person)}</small></div><span class="hand-level level-${person.level.toLowerCase()}">${person.level}</span></div>`;
}

function queueItem(queue) {
  const players = queuePlayers(queue);
  return `
    <article class="queue-item">
      <div class="queue-line">
        <div class="queue-number"><b>${queue.code}</b><div><strong>${players.map((person) => person.name).join(" · ")}</strong><small>รอ ${minutesSince(queue.createdAt)} นาที · ${players.map((p) => p.level).join("/")}</small></div></div>
        <button class="button small secondary" data-action="assign" data-queue="${queue.id}">จัดสนาม</button>
      </div>
      <div class="queue-players">${players.map((person) => initialsAvatar(person)).join("")}<span class="avatar more">4</span></div>
    </article>`;
}

function memberSearchPicker({ hiddenId, action, people = state.members, placeholder = "พิมพ์ชื่อหรือเบอร์ หรือกดเพื่อเลือก", extraClass = "", selectedId = null }) {
  const selectedPerson = selectedId ? member(selectedId) : null;
  const options = people.map((person) => `<button type="button" class="picker-option" data-action="${action}" data-person="${person.id}" data-search="${person.name} ${person.short} ${person.phone || ""} ${person.level} ${membershipName(person)}">
    ${initialsAvatar(person)}
    <span class="picker-person"><strong>${person.name}</strong><small>${person.phone ? `${person.phone} · ` : ""}มือ ${person.level} · ${membershipName(person)}</small></span>
  </button>`).join("");
  return `<div class="player-picker ${extraClass}">
    <div class="picker-control">
      <input class="ball-player-search" type="search" role="combobox" aria-expanded="false" placeholder="${placeholder}" autocomplete="off" value="${selectedPerson ? `${selectedPerson.name} · มือ ${selectedPerson.level}` : ""}">
      <input class="picker-value" id="${hiddenId}" type="hidden" value="${selectedPerson?.id || ""}">
      <button class="picker-toggle" type="button" data-action="toggle-picker" aria-label="เปิดรายชื่อผู้เล่น">⌄</button>
    </div>
    <div class="picker-menu" role="listbox">${options}<div class="picker-empty" hidden>ไม่พบรายชื่อที่ค้นหา</div></div>
  </div>`;
}

function playerIdentityView() {
  return `
    <section class="identity-layout page-enter">
      <aside class="mobile-hero identity-hero">
        <p class="eyebrow" style="color:var(--lime)">PLAYER SPACE</p>
        <h1>เลือกชื่อของคุณ<br>ก่อนเริ่มใช้งาน</h1>
        <p>เพื่อให้ระบบแสดงคิว ยอดค่าเล่น และหลักฐานชำระเงินได้ถูกคน</p>
        <div class="identity-steps">
          <span><b>1</b> เลือกชื่อตัวเอง</span>
          <span><b>2</b> เช็คอินก่อนลงคิว</span>
          <span><b>3</b> ดูยอดและแนบหลักฐาน</span>
        </div>
      </aside>
      <section class="section-card identity-card">
        <div class="identity-icon">♙</div>
        <p class="eyebrow">ระบุตัวตนผู้เล่น</p>
        <h2>วันนี้คุณคือใคร?</h2>
        <p>เลือกจากรายชื่อที่แอดมินเพิ่มไว้ใน Master สมาชิก</p>
        <div class="field identity-field">
          <label>ชื่อผู้เล่น</label>
          ${memberSearchPicker({ hiddenId: "playerIdentitySelect", action: "pick-player-identity", placeholder: "พิมพ์ชื่อหรือเบอร์ หรือกดเพื่อเลือก", extraClass: "identity-member-picker" })}
        </div>
        <button class="button block" data-action="select-player-profile">ดูหน้าของฉัน →</button>
        <div class="identity-help"><strong>หาไม่เจอหรือมาครั้งแรก?</strong><span>แจ้งชื่อกับแอดมินให้เพิ่มเข้าระบบก่อน เพื่อป้องกันรายชื่อซ้ำหรือข้อมูลมั่ว</span></div>
      </section>
    </section>`;
}

function playerPaymentCard(person) {
  const totals = getPaymentTotals();
  const games = state.ballRounds.filter((round) => round.playerIds.includes(person.id)).length;
  const purchases = state.purchases.filter((purchase) => purchase.personId === person.id);
  const today = totals.byPerson[person.id] || 0;
  const todayOutstanding = state.payments[person.id] ? 0 : today;
  const outstanding = person.previousDue + todayOutstanding;
  const proof = state.paymentProofs[person.id];
  const paymentStatus = state.payments[person.id] && !person.previousDue
    ? `<span class="badge success">✓ ชำระแล้ว</span>`
    : proof
      ? `<span class="badge warning">◷ ส่งหลักฐานแล้ว</span>`
      : outstanding > 0
        ? `<span class="badge danger">รอชำระ</span>`
        : `<span class="badge">ยังไม่มียอด</span>`;
  const todayItems = [games ? `${games} เกม` : "", totals.entryByPerson[person.id] ? `ค่าเข้า ฿${state.settings.guestEntryFee}` : "", purchases.length ? `ซื้อของ ${purchases.length} รายการ` : ""].filter(Boolean).join(" + ") || "ยังไม่มีรายการวันนี้";
  const purchaseItems = purchases.map((purchase) => `${product(purchase.productId).name} ×${purchase.quantity}`).join(" · ");
  return `
    <section class="section-card player-payment-card">
      <div class="section-title"><div><h2>ยอดของฉัน</h2><small>${todayItems}</small></div>${paymentStatus}</div>
      <div class="payment-summary">
        <div><span>ยอดวันนี้</span><strong>฿${formatMoney(today)}</strong></div>
        <div><span>ยอดค้างเดิม</span><strong class="${person.previousDue ? "danger-text" : ""}">฿${formatMoney(person.previousDue)}</strong></div>
        <div class="payment-total"><span>ยอดที่ต้องชำระ</span><strong>฿${formatMoney(outstanding)}</strong></div>
      </div>
      ${purchaseItems ? `<div class="purchase-note"><strong>ซื้อของวันนี้</strong><span>${purchaseItems}</span></div>` : ""}
      ${proof
        ? `<div class="proof-pending"><span>📎</span><div><strong>ส่งหลักฐานแล้ว</strong><small>รอแอดมินตรวจและกดยืนยันรับชำระ</small></div></div>`
        : outstanding > 0
          ? `<div class="proof-upload"><label for="paymentProof">แนบสลิปหรือหลักฐานการชำระ</label><input id="paymentProof" type="file" accept="image/*,.pdf"><button class="button" data-action="submit-payment-proof">ส่งหลักฐาน</button></div>`
          : `<div class="paid-note">วันนี้ยังไม่มียอดที่ต้องชำระ</div>`}
    </section>`;
}

function queueBuilder(person) {
  if (person.previousDue) return `<section class="section-card locked-card"><span class="locked-icon">!</span><div><h2>ยังลงคิวไม่ได้</h2><p>มียอดค้าง ฿${formatMoney(person.previousDue)} กรุณาแนบหลักฐานและรอแอดมินยืนยันก่อน</p></div></section>`;
  if (!person.checkedIn) return `<section class="section-card locked-card"><span class="locked-icon">✓</span><div><h2>เช็คอินก่อนลงคิว</h2><p>กด “เช็คอินชื่อนี้” ด้านซ้าย แล้วจึงเลือกผู้เล่นว่าง 4 คนได้</p></div></section>`;
  return `
    <section class="section-card">
      <div class="section-title"><div><h2>รวมทีมลงคิว</h2><small>เลือกผู้เล่นว่างให้ครบ 4 คน</small></div><button class="button small secondary" data-action="clear-selection">ล้าง</button></div>
      <div class="people-grid">${availableMembers().map(personSelectCard).join("")}</div>
      <div class="selection-footer"><span>เลือกแล้ว <b id="selectedCount">${state.selectedPlayers.length}</b>/4 คน</span><button class="button" data-action="create-queue" ${state.selectedPlayers.length !== 4 ? "disabled" : ""}>ยืนยันลงคิว →</button></div>
    </section>`;
}

function mobileView() {
  if (!state.currentPlayerId || !member(state.currentPlayerId)) return playerIdentityView();
  const currentUser = member(state.currentPlayerId);
  const myQueue = state.queues.find((queue) => queue.playerIds.includes(currentUser.id) && queue.status !== "done");
  const profileStatus = currentUser.previousDue
    ? `<span class="eligibility blocked">ค้าง ฿${formatMoney(currentUser.previousDue)}</span>`
    : currentUser.checkedIn
      ? `<span class="eligibility">✓ เช็คอินแล้ว</span>`
      : `<span class="eligibility waiting">ยังไม่เช็คอิน</span>`;
  return `
    <section class="mobile-layout page-enter">
      <aside class="mobile-hero">
        <p class="eyebrow" style="color:var(--lime)">PLAYER SPACE</p>
        <h1>สวัสดี ${currentUser.short}<br>พร้อมตีหรือยัง?</h1>
        <p>นี่คือหน้าส่วนตัวสำหรับเช็คอิน ลงคิว และตรวจยอดค่าเล่น</p>
        <div class="profile-card">${initialsAvatar(currentUser)}<div><strong>${currentUser.name}</strong><small>${membershipName(currentUser)} · มือ ${currentUser.level}</small></div>${profileStatus}</div>
        <div class="hero-buttons">
          ${!currentUser.checkedIn && !currentUser.previousDue ? `<button class="button lime" data-action="self-checkin">✓ เช็คอินชื่อนี้</button>` : currentUser.checkedIn ? `<button class="button lime" data-action="checkin">＋ เช็คอินให้เพื่อน</button>` : ""}
          <button class="button hero-secondary checkout-mobile" data-action="show-checkout-picker">↗ เช็คเอาท์คนกลับบ้าน</button>
          <button class="button hero-secondary" data-action="switch-player-profile">เปลี่ยนชื่อผู้ใช้งาน</button>
        </div>
        <div class="player-help"><strong>มาครั้งแรกหรือไม่มีชื่อ?</strong><span>แจ้งแอดมินเพิ่มรายชื่อก่อน แล้วค่อยกลับมาเลือกเช็คอิน</span></div>
      </aside>
      <div class="mobile-content">
        ${playerPaymentCard(currentUser)}
        <section class="section-card">
          <div class="section-title"><h2>สนามตอนนี้</h2><small>${state.courts.filter((court) => court.active && !getPlayingQueue(court.id)).length} สนามว่าง</small></div>
          <div class="court-strip">${state.courts.map((court) => `<div class="court-mini ${getPlayingQueue(court.id) ? "playing" : court.active ? "" : "closed"}"><strong>${court.name.replace("สนาม ", "")}</strong><small>${getPlayingQueue(court.id) ? `เล่น ${minutesSince(getPlayingQueue(court.id).startedAt)} นาที` : court.active ? "พร้อมเล่น" : "ปิดชั่วคราว"}</small></div>`).join("")}</div>
          <div class="court-management-list">${activePlayingQueues().map((queue) => `<div class="court-management-row"><div><strong>สนาม ${queue.courtId} · ${queue.code}</strong><small>${personNames(queue)}</small></div><div class="court-management-actions"><button class="button small secondary" data-action="requeue" data-queue="${queue.id}">↩ คืนไปรอคิว</button><button class="button small coral" data-action="finish" data-queue="${queue.id}">✓ จบเกม</button></div></div>`).join("") || `<div class="empty-state">ทุกสนามว่าง พร้อมเรียกคิวถัดไป</div>`}</div>
        </section>
        ${myQueue ? `<section class="my-queue"><div><p>${myQueue.status === "playing" ? `กำลังเล่น · สนาม ${myQueue.courtId}` : `คิวของคุณ ${myQueue.code}`}</p><small>${personNames(myQueue)}</small></div><span class="badge ${myQueue.status === "playing" ? "success" : "warning"}">${myQueue.status === "playing" ? "IN GAME" : `รอ ${waitingQueues().findIndex((q) => q.id === myQueue.id) + 1} คิว`}</span></section>` : ""}
        ${queueBuilder(currentUser)}
        ${currentUser.checkedIn && !currentUser.previousDue ? `<section class="section-card">
          <div class="section-title"><h2>คิวที่รออยู่</h2><small>ทุกคนช่วยบริหารได้</small></div>
          <div class="queue-list" style="padding:0">${waitingQueues().length ? waitingQueues().map(queueItem).join("") : `<div class="empty-state">ไม่มีคิวรอในตอนนี้</div>`}</div>
        </section>` : ""}
      </div>
    </section>`;
}

function personSelectCard(person) {
  const selected = state.selectedPlayers.includes(person.id);
  return `<button class="person-select ${selected ? "selected" : ""}" data-action="toggle-player" data-person="${person.id}">${initialsAvatar(person)}<span><strong>${person.name}</strong><small>มือ ${person.level} · ${membershipName(person)}</small></span><i class="check">✓</i></button>`;
}

const adminTabs = [
  ["overview", "▦", "ภาพรวม"], ["balls", "◉", "เบิกลูกเล่น"], ["shop", "▤", "ซื้อของ"], ["payments", "฿", "รายการชำระเงิน"], ["people", "♙", "สมาชิก"], ["masters", "⚙", "ข้อมูลระบบ"],
];

function adminView() {
  if (!state.adminUnlocked) return adminLoginView();
  return `
    <section class="admin-shell page-enter">
      <aside class="admin-sidebar">
        <div class="admin-label">ADMIN CONTROL</div>
        <nav class="admin-nav">${adminTabs.map(([id, icon, label]) => `<button class="admin-tab ${state.adminTab === id ? "active" : ""}" data-admin-tab="${id}"><span>${icon}</span>${label}</button>`).join("")}</nav>
        <div class="admin-user"><span class="avatar">AD</span><div><strong>แอดมินอุทัย</strong><small>ผู้ดูแลระบบ</small></div><button data-action="admin-logout" title="ออกจากระบบ">ออก</button></div>
      </aside>
      <div class="admin-content">${adminTabContent()}</div>
    </section>`;
}

function adminLoginView() {
  return `
    <section class="admin-login page-enter">
      <div class="admin-login-card">
        <span class="admin-login-icon">⚙</span>
        <p class="eyebrow">ADMIN ACCESS</p>
        <h1>เข้าสู่ระบบผู้ดูแล</h1>
        <p>กรอก PIN 4 หลักเพื่อจัดการคิว การเงิน สมาชิก และข้อมูลระบบ</p>
        <form id="adminLoginForm" class="admin-login-form">
          <label for="adminPin">PIN ผู้ดูแล</label>
          <input id="adminPin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="one-time-code" placeholder="••••" autofocus required>
          <small id="adminLoginError" aria-live="polite"></small>
          <button class="button block" type="submit">เข้าสู่ระบบ →</button>
        </form>
        <div class="admin-pin-hint"><strong>PIN เริ่มต้น</strong><span>8888</span></div>
      </div>
    </section>`;
}

function attemptAdminLogin() {
  const input = app.querySelector("#adminPin");
  const error = app.querySelector("#adminLoginError");
  const pin = input?.value.trim() || "";
  if (!/^\d{4}$/.test(pin)) {
    error.textContent = "กรุณากรอกตัวเลขให้ครบ 4 หลัก";
    input?.focus();
    return;
  }
  if (pin !== "8888") {
    error.textContent = "PIN ไม่ถูกต้อง กรุณาลองใหม่";
    input.value = "";
    input.focus();
    return;
  }
  state.adminUnlocked = true;
  sessionStorage.setItem("uthai-admin-unlocked", "true");
  render();
  showToast("เข้าสู่ระบบผู้ดูแลแล้ว");
}

function adminTabContent() {
  if (state.adminTab === "balls") return ballsAdmin();
  if (state.adminTab === "shop") return shopAdmin();
  if (state.adminTab === "payments") return paymentsAdmin();
  if (state.adminTab === "people") return peopleAdmin();
  if (state.adminTab === "masters") return mastersAdmin();
  return overviewAdmin();
}

function overviewAdmin() {
  const metrics = getDashboardMetrics();
  const report = dashboardPeriodData(metrics, state.dashboardPeriod);
  const maxDaily = Math.max(...report.series.map((day) => day.value), 1);
  return `
    <div class="page-heading"><div><p class="eyebrow">ADMIN DASHBOARD</p><h1>ภาพรวมสนามและรายรับ</h1><p>สถานะประจำวันที่ ${new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}</p></div><div class="dashboard-heading-actions"><button class="button secondary" data-action="download-debt-image">⇩ รูปทวงเงิน</button><button class="button" data-action="checkin">＋ เช็คอินลูกค้า</button></div></div>
    <div class="dashboard-period-bar"><div><strong>ดูรายรับ</strong><span>${report.description}</span></div><div class="dashboard-period-tabs">${[["day", "วันนี้"], ["month", "เดือนนี้"], ["year", "ปีนี้"]].map(([period, label]) => `<button class="${state.dashboardPeriod === period ? "active" : ""}" data-action="set-dashboard-period" data-period="${period}">${label}</button>`).join("")}</div></div>
    <div class="stat-grid dashboard-stats">
      <div class="stat-card featured"><div class="stat-icon">฿</div><strong>${formatMoney(metrics.today)}</strong><small>รายรับวันนี้</small><span>จาก ${metrics.games} เกม</span></div>
      <div class="stat-card"><div class="stat-icon">30</div><strong>${formatMoney(metrics.month)}</strong><small>รายรับเดือนนี้</small><span>รวมยอดวันนี้แล้ว</span></div>
      <div class="stat-card"><div class="stat-icon">ปี</div><strong>${formatMoney(metrics.year)}</strong><small>รายรับปีนี้</small><span>ข้อมูลสะสมทั้งปี</span></div>
      <div class="stat-card"><div class="stat-icon">🏸</div><strong>${metrics.balls}</strong><small>ลูกที่เบิกวันนี้</small><span>${metrics.games} เกม · ค่าระบบ ${systemFeeLabel()}</span></div>
    </div>
    <div class="dashboard-grid">
      <section class="panel revenue-panel"><div class="panel-header"><div><h2>${report.title}</h2><p>สลับช่วงเวลาเพื่อดูภาพรวมรายวัน รายเดือน และรายปี</p></div><span class="badge success">รวม ฿${formatMoney(report.total)}</span></div>
        <div class="revenue-bars" style="grid-template-columns:repeat(${report.series.length},1fr)">${report.series.map((day) => `<div class="revenue-day"><strong>฿${formatMoney(day.value)}</strong><div class="revenue-track"><i style="height:${Math.max(10, Math.round(day.value / maxDaily * 100))}%"></i></div><small>${day.label}</small></div>`).join("")}</div>
      </section>
      <section class="panel dashboard-summary"><div class="panel-header"><div><h2>เงินวันนี้มาจากไหน</h2><p>รวมทุกช่องทางไว้ในหน้าเดียว</p></div></div>
        <div class="breakdown-list">
          ${dashboardBreakdownRow("ค่าลูกและค่าระบบตามการใช้", metrics.ballRevenue, metrics.today)}
          ${dashboardBreakdownRow("ค่าเข้าบุคคลภายนอก", metrics.entryRevenue, metrics.today)}
          ${dashboardBreakdownRow("น้ำและอุปกรณ์", metrics.shopRevenue, metrics.today)}
        </div>
        <div class="developer-fee-box"><div><small>ยอดค่าระบบส่งผู้พัฒนา</small><strong>฿${formatMoney(metrics.developerFeeDue)}</strong><span>${state.settings.systemChargeMode === "per_shuttle" ? `${metrics.balls} ลูก × ฿${formatMoney(state.settings.systemFeePerShuttle)}` : "เหมาจ่ายประจำเดือนนี้"}</span></div><button class="button small secondary" data-action="goto-admin" data-tab="masters">ตั้งค่าวิธีคิด</button></div>
        <div class="outstanding-box"><div><small>ยอดยังไม่ชำระ</small><strong>฿${formatMoney(metrics.outstanding)}</strong><span>${metrics.debtors} คน · ดาวน์โหลดรูปส่ง Line ได้</span></div><button class="button small coral" data-action="goto-admin" data-tab="payments">ไปหน้าชำระเงิน</button></div>
      </section>
    </div>
    <div class="quick-admin-actions"><button data-action="goto-admin" data-tab="balls"><span>◉</span><strong>เบิกลูกเกมใหม่</strong><small>เลือกผู้เล่น 4 คน</small></button><button data-action="goto-admin" data-tab="shop"><span>▤</span><strong>ลงรายการซื้อของ</strong><small>ผูกยอดกับรายคน</small></button><button data-action="goto-admin" data-tab="payments"><span>฿</span><strong>ตรวจยอดและสลิป</strong><small>ปิดยอดก่อนวันถัดไป</small></button></div>
    <div class="admin-grid">
      <section class="panel"><div class="panel-header"><div><h2>การใช้งานสนาม</h2><p>จัดคิวและปิดเกมจากหน้านี้ได้</p></div><button class="button small lime" data-action="open-queue">+ เพิ่มคิว</button></div><div class="data-list">${state.courts.map(adminCourtRow).join("")}</div></section>
      <section class="panel"><div class="panel-header"><div><h2>คิวรอ</h2><p>เรียงตามลำดับล่าสุด</p></div></div><div class="queue-list">${waitingQueues().map(queueItem).join("") || `<div class="empty-state">ไม่มีคิวรอ</div>`}</div></section>
    </div>`;
}

function dashboardBreakdownRow(label, value, total) {
  const width = total ? Math.max(4, Math.round(value / total * 100)) : 0;
  return `<div class="breakdown-row"><div><span>${label}</span><strong>฿${formatMoney(value)}</strong></div><div class="breakdown-track"><i style="width:${width}%"></i></div></div>`;
}

function distributePeriodTotal(total, labels, weights) {
  let used = 0;
  return labels.map((label, index) => {
    const value = index === labels.length - 1 ? Math.max(0, total - used) : Math.round(total * weights[index]);
    used += value;
    return { label, value };
  });
}

function dashboardPeriodData(metrics, period) {
  if (period === "year") {
    const labels = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค."];
    return { title: "รายรับรายเดือนปีนี้", description: "มกราคม–ตุลาคม 2569", total: metrics.year, series: distributePeriodTotal(metrics.year, labels, [.07, .075, .08, .085, .09, .095, .105, .115, .13, .155]) };
  }
  if (period === "month") {
    const labels = ["สัปดาห์ 1", "สัปดาห์ 2", "สัปดาห์ 3", "สัปดาห์ 4"];
    return { title: "รายรับรายสัปดาห์เดือนนี้", description: "ตุลาคม 2569", total: metrics.month, series: distributePeriodTotal(metrics.month, labels, [.21, .24, .25, .30]) };
  }
  const labels = ["17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];
  return { title: "รายรับวันนี้ตามช่วงเวลา", description: "20 ตุลาคม 2569", total: metrics.today, series: distributePeriodTotal(metrics.today, labels, [.06, .14, .24, .27, .19, .10]) };
}

function adminCourtRow(court) {
  const queue = getPlayingQueue(court.id);
  return `<div class="data-row" style="grid-template-columns:.55fr 1.4fr .7fr auto"><strong>${court.name}</strong><span>${queue ? personNames(queue) : "พร้อมใช้งาน"}</span><span class="badge ${queue ? "success" : ""}">${queue ? `${minutesSince(queue.startedAt)} นาที` : "ว่าง"}</span>${queue ? `<div class="table-actions"><button class="button small secondary" data-action="requeue" data-queue="${queue.id}">คืนไปรอคิว</button><button class="button small coral" data-action="finish" data-queue="${queue.id}">จบเกม</button></div>` : waitingQueues().length ? `<button class="button small" data-action="assign" data-queue="${waitingQueues()[0].id}" data-court="${court.id}">เรียก ${waitingQueues()[0].code}</button>` : ""}</div>`;
}

function ballPlayerPicker(index, selectedId = null, allowAll = false) {
  const selectedPerson = selectedId ? member(selectedId) : null;
  const options = state.members.map((person) => {
    const overdue = person.previousDue > 0;
    const unavailable = allowAll ? false : !person.checkedIn || overdue;
    const status = overdue
      ? `ค้าง ฿${formatMoney(person.previousDue)} · ระงับสิทธิ์`
      : person.checkedIn
        ? `${membershipName(person)} · มือ ${person.level}`
        : "ยังไม่เช็คอิน";
    return `<button type="button" class="picker-option ${!allowAll && overdue ? "blocked" : unavailable ? "unavailable" : ""}" ${unavailable ? "disabled" : `data-action="pick-ball-player"`} data-person="${person.id}" data-search="${person.name} ${person.short} ${person.phone || ""} ${person.level} ${membershipName(person)}">
      ${initialsAvatar(person)}
      <span class="picker-person"><strong>${person.name}</strong><small>${person.phone ? `${person.phone} · ` : ""}มือ ${person.level}</small></span>
      <span class="picker-status ${overdue ? "danger" : ""}">${status}</span>
    </button>`;
  }).join("");
  return `<div class="player-picker" data-picker>
    <div class="picker-control">
      <input class="ball-player-search" data-slot="${index}" type="search" role="combobox" aria-expanded="false" aria-label="ค้นหาผู้เล่นคนที่ ${index + 1}" placeholder="พิมพ์ชื่อ หรือเลือกคนที่ ${index + 1}" autocomplete="off" value="${selectedPerson ? `${selectedPerson.name} · มือ ${selectedPerson.level}` : ""}">
      <input class="ball-player picker-value" type="hidden" value="${selectedPerson?.id || ""}">
      <button class="picker-toggle" type="button" data-action="toggle-picker" aria-label="เปิดรายชื่อผู้เล่น">⌄</button>
    </div>
    <div class="picker-menu" role="listbox">${options}<div class="picker-empty" hidden>ไม่พบรายชื่อที่ค้นหา</div></div>
  </div>`;
}

function adminFilterBar(page, { showDate = true, sortOptions = [] } = {}) {
  const filter = state.adminFilters[page];
  return `<form class="admin-filter-bar" data-admin-filter-form="${page}">
    ${showDate ? `<label><span>วันที่</span><input name="date" type="date" value="${selectedDateKey(filter.date)}"></label>` : ""}
    <label class="admin-filter-search"><span>ค้นหา</span><input name="query" type="search" value="${filter.query}" placeholder="พิมพ์ชื่อ เบอร์ หรือรายการ"></label>
    <label><span>เรียงตาม</span><select name="sort">${sortOptions.map(([value, label]) => `<option value="${value}" ${filter.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <button class="button small" type="submit">แสดงผล</button>
    <button class="button small secondary" type="button" data-action="clear-admin-filter" data-page="${page}">ล้าง</button>
  </form>`;
}

function adminSearchMatch(parts, query) {
  if (!query) return true;
  return parts.filter(Boolean).join(" ").toLocaleLowerCase("th-TH").includes(query.toLocaleLowerCase("th-TH"));
}

function ballsAdmin() {
  const filter = state.adminFilters.balls;
  const activeShuttles = state.shuttles.filter((item) => item.active);
  const selectedShuttle = activeShuttles[0];
  const rounds = state.ballRounds.filter((round) => matchesAdminDate(round.createdAt, filter.date) && adminSearchMatch([
    round.shuttleName || shuttleLabel(shuttle(round.shuttleId)),
    ...round.playerIds.map((id) => member(id)?.name),
  ], filter.query)).sort((a, b) => {
    if (filter.sort === "oldest") return a.createdAt - b.createdAt;
    if (filter.sort === "amount_desc") return (b.balls * b.ballCost + b.fee) - (a.balls * a.ballCost + a.fee);
    return b.createdAt - a.createdAt;
  });
  const firstBallCost = selectedShuttle?.price || 0;
  const firstSystemFee = systemFeeForRound(1);
  if (state.ballAdminMode === "add") return `
    <div class="page-heading"><div><p class="eyebrow">ห้องเบิกลูก · เพิ่มรายการ</p><h1>เบิกลูกเกมใหม่</h1><p>ผู้เล่นคนเดิมเลือกซ้ำได้ หากออกค่าลูกหรือเลี้ยงให้อีกคน</p></div><button class="button secondary" data-action="set-ball-mode" data-mode="list">← กลับตารางรายการ</button></div>
    <section class="panel picker-panel ball-create-panel"><div class="panel-header"><div><h2>ข้อมูลเกมและผู้รับผิดชอบค่าใช้จ่าย</h2><p>ค้นหาด้วยชื่อหรือเบอร์ · เลือกให้ครบ 4 ช่อง · ชื่อซ้ำจะคิดค่าใช้จ่ายตามจำนวนช่อง</p></div><span class="badge blue">CREATE</span></div>
      <div class="ball-form">
        <div class="field"><label>ผู้เล่น / ผู้รับผิดชอบค่าใช้จ่าย 4 ช่อง</label><div class="four-selects">${[0,1,2,3].map(ballPlayerPicker).join("")}</div><small class="field-help">กรณีคนหนึ่งออกค่าใช้จ่ายให้อีกคน สามารถเลือกชื่อเดิมซ้ำได้</small></div>
        <div class="shop-form-row"><div class="field"><label for="ballShuttle">ยี่ห้อ / รุ่นลูกแบด</label><select id="ballShuttle">${activeShuttles.map((item) => `<option value="${item.id}">${shuttleLabel(item)} · ฿${formatMoney(item.price)}/ลูก</option>`).join("")}</select></div><div class="field"><label for="ballCount">จำนวนที่เบิก</label><select id="ballCount">${[1,2,3].map((count) => `<option value="${count}">${count} ลูก</option>`).join("")}</select></div></div>
        <div class="cost-box" id="costPreview"><div class="cost-line"><span>${selectedShuttle ? shuttleLabel(selectedShuttle) : "ไม่มีลูกแบดที่เปิดใช้"}</span><strong class="money">฿${formatMoney(firstBallCost)}</strong></div><div class="cost-line"><span>ค่าระบบ · ${systemFeeLabel()}</span><strong class="money">฿${formatMoney(firstSystemFee)}</strong></div><div class="cost-line total"><span>รวม / หาร 4 ช่อง</span><strong class="money">฿${formatMoney((firstBallCost + firstSystemFee) / 4)} ต่อช่อง</strong></div></div>
        <button class="button block" data-action="issue-ball" ${selectedShuttle ? "" : "disabled"}>ยืนยันเบิกลูกและบันทึกเกม</button>
      </div>
    </section>`;
  return `
    <div class="page-heading"><div><p class="eyebrow">ห้องเบิกลูก · จัดการรายการ</p><h1>ตารางเบิกลูกทั้งหมด</h1><p>ค้นหา ตรวจสอบ แก้ผู้เล่น ราคา จำนวน หรือเวลาย้อนหลังได้</p></div><button class="button" data-action="set-ball-mode" data-mode="add">＋ เพิ่มเกมใหม่</button></div>
    <section class="panel ball-rounds-panel"><div class="panel-header"><div><h2>ประวัติเบิกลูก</h2><p>พบ ${rounds.length} รายการจากตัวกรอง</p></div><span class="badge success">CRUD</span></div>
      ${adminFilterBar("balls", { sortOptions: [["newest", "ล่าสุดก่อน"], ["oldest", "เก่าสุดก่อน"], ["amount_desc", "ยอดสูงสุด"]] })}
      <div class="admin-table-wrap"><table class="admin-table ball-rounds-table"><thead><tr><th>เกม / วันเวลา</th><th>ผู้เล่น / ผู้จ่าย 4 ช่อง</th><th>ลูกแบด</th><th>จำนวน</th><th>ราคาต่อลูก</th><th>ค่าระบบ</th><th>รวม</th><th>จัดการ</th></tr></thead><tbody>${rounds.map((round) => { const total = round.balls * round.ballCost + round.fee; return `<tr><td><strong>#${String(round.id).padStart(2,"0")}</strong><small>${new Date(round.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })} · ${new Date(round.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</small></td><td><div class="table-player-list">${round.playerIds.map((id, index) => `<span>${index + 1}. ${member(id)?.short || "ไม่พบชื่อ"}</span>`).join("")}</div></td><td>${round.shuttleName || shuttleLabel(shuttle(round.shuttleId))}</td><td>${round.balls} ลูก</td><td class="money">฿${formatMoney(round.ballCost)}</td><td class="money">฿${formatMoney(round.fee)}</td><td><strong class="money">฿${formatMoney(total)}</strong><small>฿${formatMoney(total / 4)}/ช่อง</small></td><td><div class="table-actions"><button class="button small secondary" data-action="edit-ball-round" data-round="${round.id}">แก้ไข</button><button class="button small coral" data-action="show-delete-ball-round" data-round="${round.id}">ลบ</button></div></td></tr>`; }).join("") || `<tr><td colspan="8"><div class="empty-state">ไม่พบรายการตามวันที่หรือคำค้น</div></td></tr>`}</tbody></table></div>
    </section>`;
}

function shopAdmin() {
  const activeProducts = state.products.filter((item) => item.active);
  const salesTotal = state.purchases.reduce((sum, purchase) => sum + purchase.quantity * purchase.unitPrice, 0);
  const filter = state.adminFilters.shop;
  const purchases = state.purchases.filter((purchase) => matchesAdminDate(purchase.createdAt, filter.date) && adminSearchMatch([
    member(purchase.personId)?.name,
    member(purchase.personId)?.phone,
    product(purchase.productId)?.name,
  ], filter.query)).sort((a, b) => {
    if (filter.sort === "oldest") return a.createdAt - b.createdAt;
    if (filter.sort === "amount_desc") return (b.quantity * b.unitPrice) - (a.quantity * a.unitPrice);
    return b.createdAt - a.createdAt;
  });
  if (state.shopAdminMode === "add") return `
    <div class="page-heading"><div><p class="eyebrow">ขายหน้าสนาม · เพิ่มรายการ</p><h1>เพิ่มรายการซื้อ</h1><p>เลือกลูกค้า สินค้า และจำนวน ระบบจะรวมยอดกับค่าลูกตอนปิดยอด</p></div><button class="button secondary" data-action="set-shop-mode" data-mode="list">← กลับตารางรายการ</button></div>
    <section class="panel picker-panel purchase-create-panel"><div class="panel-header"><div><h2>ข้อมูลการซื้อ</h2><p>ค้นหาชื่อหรือเบอร์ แล้วเลือกสินค้าใน Master</p></div><span class="badge blue">CREATE</span></div>
      <div class="ball-form">
        <div class="field"><label>ผู้ซื้อ</label>${memberSearchPicker({ hiddenId: "shopPerson", action: "pick-shop-person", people: checkedInMembers(), placeholder: "พิมพ์ชื่อหรือเบอร์ หรือกดเพื่อเลือก" })}</div>
        <div class="shop-form-row">
          <div class="field"><label for="shopProduct">สินค้า</label><select id="shopProduct">${activeProducts.map((item) => `<option value="${item.id}">${item.name} · ฿${formatMoney(item.price)}</option>`).join("")}</select></div>
          <div class="field"><label for="shopQuantity">จำนวน</label><select id="shopQuantity">${[1,2,3,4,5].map((quantity) => `<option value="${quantity}">${quantity}</option>`).join("")}</select></div>
        </div>
        <div class="cost-box" id="shopCostPreview"><div class="cost-line"><span>${activeProducts[0]?.name || "ไม่มีสินค้าที่เปิดขาย"} × 1</span><strong class="money">฿${formatMoney(activeProducts[0]?.price || 0)}</strong></div><div class="cost-line total"><span>บวกเข้ายอดของผู้ซื้อ</span><strong>ชำระพร้อมค่าลูก</strong></div></div>
        <button class="button block" data-action="record-purchase" ${activeProducts.length ? "" : "disabled"}>บันทึกซื้อของ</button>
      </div>
    </section>`;
  return `
    <div class="page-heading"><div><p class="eyebrow">ขายหน้าสนาม · จัดการรายการ</p><h1>ตารางซื้อของทั้งหมด</h1><p>ค้นหา เรียง แก้ผู้ซื้อ สินค้า จำนวน ราคา หรือเวลาได้</p></div><button class="button" data-action="set-shop-mode" data-mode="add">＋ เพิ่มรายการซื้อ</button></div>
    <div class="stat-grid shop-stats">
      <div class="stat-card"><div class="stat-icon">฿</div><strong>${formatMoney(salesTotal)}</strong><small>ยอดขายวันนี้</small></div>
      <div class="stat-card"><div class="stat-icon">▤</div><strong>${state.purchases.length}</strong><small>รายการขาย</small></div>
      <div class="stat-card"><div class="stat-icon">◉</div><strong>${activeProducts.filter((item) => item.category === "drink").length}</strong><small>รายการน้ำ</small></div>
      <div class="stat-card"><div class="stat-icon">⌁</div><strong>${activeProducts.filter((item) => item.category === "equipment").length}</strong><small>รายการอุปกรณ์</small></div>
    </div>
    <section class="panel purchase-rounds-panel"><div class="panel-header"><div><h2>ประวัติการขาย</h2><p>พบ ${purchases.length} รายการจากตัวกรอง</p></div><span class="badge success">CRUD</span></div>
      ${adminFilterBar("shop", { sortOptions: [["newest", "ล่าสุดก่อน"], ["oldest", "เก่าสุดก่อน"], ["amount_desc", "ยอดสูงสุด"]] })}
      <div class="admin-table-wrap"><table class="admin-table purchase-rounds-table"><thead><tr><th>รายการ / วันเวลา</th><th>ผู้ซื้อ</th><th>สินค้า</th><th>ประเภท</th><th>จำนวน</th><th>ราคาต่อหน่วย</th><th>รวม</th><th>จัดการ</th></tr></thead><tbody>${purchases.map((purchase) => { const item = product(purchase.productId); const buyer = member(purchase.personId); return `<tr><td><strong>#${String(purchase.id).padStart(3, "0")}</strong><small>${new Date(purchase.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })} · ${new Date(purchase.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</small></td><td><strong>${buyer?.name || "ไม่พบชื่อ"}</strong><small>${buyer?.phone || "-"}</small></td><td>${item?.name || "ไม่พบสินค้า"}</td><td><span class="badge ${item?.category === "drink" ? "blue" : "warning"}">${item ? productCategoryName(item) : "-"}</span></td><td>${purchase.quantity}</td><td class="money">฿${formatMoney(purchase.unitPrice)}</td><td><strong class="money">฿${formatMoney(purchase.quantity * purchase.unitPrice)}</strong></td><td><div class="table-actions"><button class="button small secondary" data-action="edit-purchase" data-purchase="${purchase.id}">แก้ไข</button><button class="button small coral" data-action="show-delete-purchase" data-purchase="${purchase.id}">ลบ</button></div></td></tr>`; }).join("") || `<tr><td colspan="8"><div class="empty-state">ไม่พบรายการตามวันที่หรือคำค้น</div></td></tr>`}</tbody></table></div>
    </section>`;
}

function getPaymentTotals() {
  const byPerson = {};
  const entryByPerson = {};
  const purchaseByPerson = {};
  state.members.forEach((person) => {
    entryByPerson[person.id] = person.membership === "guest" && visitedToday(person) ? state.settings.guestEntryFee : 0;
    byPerson[person.id] = entryByPerson[person.id];
    purchaseByPerson[person.id] = 0;
  });
  state.ballRounds.forEach((round) => {
    const share = (round.balls * round.ballCost + round.fee) / 4;
    round.playerIds.forEach((id) => { byPerson[id] = (byPerson[id] || 0) + share; });
  });
  state.purchases.forEach((purchase) => {
    const total = purchase.quantity * purchase.unitPrice;
    purchaseByPerson[purchase.personId] = (purchaseByPerson[purchase.personId] || 0) + total;
    byPerson[purchase.personId] = (byPerson[purchase.personId] || 0) + total;
  });
  const grand = Object.values(byPerson).reduce((sum, value) => sum + value, 0);
  const entryTotal = Object.values(entryByPerson).reduce((sum, value) => sum + value, 0);
  const purchaseTotal = Object.values(purchaseByPerson).reduce((sum, value) => sum + value, 0);
  return { byPerson, entryByPerson, purchaseByPerson, entryTotal, purchaseTotal, grand };
}

function getDebtRows(personId = null) {
  const totals = getPaymentTotals();
  return state.members.map((person) => {
    const today = state.payments[person.id] ? 0 : totals.byPerson[person.id];
    const total = today + person.previousDue;
    const games = state.ballRounds.filter((round) => round.playerIds.includes(person.id)).length;
    const purchases = state.purchases.filter((purchase) => purchase.personId === person.id);
    const items = [games ? `${games} เกม` : "", totals.entryByPerson[person.id] ? `ค่าเข้า ${state.settings.guestEntryFee}` : "", purchases.length ? `ซื้อของ ${formatMoney(totals.purchaseByPerson[person.id])}` : "", person.previousDue ? `ค้างเดิม ${formatMoney(person.previousDue)}` : ""].filter(Boolean).join(" · ");
    return { person, today, total, items: items || "ยอดค้างชำระ" };
  }).filter((row) => row.total > 0 && (!personId || row.person.id === personId));
}

function getDashboardMetrics() {
  const totals = getPaymentTotals();
  const ballRevenue = state.ballRounds.reduce((sum, round) => sum + round.balls * round.ballCost + round.fee, 0);
  const balls = state.ballRounds.reduce((sum, round) => sum + round.balls, 0);
  const developerFeeDue = state.settings.systemChargeMode === "per_shuttle"
    ? state.ballRounds.reduce((sum, round) => sum + round.fee, 0)
    : state.settings.monthlySystemFee;
  const outstanding = getDebtRows().reduce((sum, row) => sum + row.total, 0);
  const labels = ["14 ต.ค.", "15 ต.ค.", "16 ต.ค.", "17 ต.ค.", "18 ต.ค.", "19 ต.ค.", "วันนี้"];
  const values = [...state.analytics.lastSixDays, totals.grand];
  const month = state.analytics.revenueBeforeToday.month + totals.grand;
  return {
    today: totals.grand,
    month,
    year: state.analytics.revenueBeforeToday.year + month,
    games: state.ballRounds.length,
    balls,
    developerFeeDue,
    ballRevenue,
    entryRevenue: totals.entryTotal,
    shopRevenue: totals.purchaseTotal,
    outstanding,
    debtors: getDebtRows().length,
    lastSevenDays: labels.map((label, index) => ({ label, value: values[index] })),
  };
}

function downloadDebtImage(personId = null) {
  const rows = getDebtRows(personId);
  if (!rows.length) return showToast("ไม่มียอดค้างสำหรับดาวน์โหลด");

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = Math.max(1080, 430 + rows.length * 104);
  const context = canvas.getContext("2d");
  const today = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
  const total = rows.reduce((sum, row) => sum + row.total, 0);

  context.fillStyle = "#f4f3ed";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#123c2c";
  context.fillRect(0, 0, canvas.width, 292);
  context.fillStyle = "#d9f36a";
  context.font = "700 32px system-ui, sans-serif";
  context.fillText("UTHAI SMASH CLUB", 72, 76);
  context.fillStyle = "#ffffff";
  context.font = "700 58px system-ui, sans-serif";
  context.fillText(personId ? "แจ้งยอดค้างชำระ" : "สรุปยอดค้างชำระ", 72, 160);
  context.fillStyle = "#b9c9c0";
  context.font = "400 27px system-ui, sans-serif";
  context.fillText(`${today} · ส่งภาพนี้ทาง Line ได้`, 72, 218);

  rows.forEach((row, index) => {
    const top = 334 + index * 104;
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.roundRect(56, top, 968, 82, 18);
    context.fill();
    context.fillStyle = "#17221d";
    context.font = "700 29px system-ui, sans-serif";
    context.fillText(row.person.name, 84, top + 34);
    context.fillStyle = "#6f7b74";
    context.font = "400 21px system-ui, sans-serif";
    context.fillText(row.items, 84, top + 64);
    context.fillStyle = "#a6422b";
    context.font = "700 31px system-ui, sans-serif";
    context.textAlign = "right";
    context.fillText(`฿${formatMoney(row.total)}`, 988, top + 51);
    context.textAlign = "left";
  });

  const summaryTop = 360 + rows.length * 104;
  context.fillStyle = "#123c2c";
  context.beginPath();
  context.roundRect(56, summaryTop, 968, 150, 22);
  context.fill();
  context.fillStyle = "#d9f36a";
  context.font = "700 25px system-ui, sans-serif";
  context.fillText(personId ? "ยอดที่ต้องชำระ" : `รวม ${rows.length} คน`, 86, summaryTop + 48);
  context.fillStyle = "#ffffff";
  context.font = "700 46px system-ui, sans-serif";
  context.fillText(`฿${formatMoney(total)}`, 86, summaryTop + 108);
  context.font = "400 21px system-ui, sans-serif";
  context.fillStyle = "#b9c9c0";
  context.textAlign = "right";
  context.fillText("กรุณาส่งหลักฐานใน Line กลุ่มเดิม", 992, summaryTop + 91);
  context.textAlign = "left";

  canvas.toBlob((blob) => {
    if (!blob) return showToast("สร้างรูปไม่สำเร็จ กรุณาลองใหม่");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = personId ? `ยอดค้าง-${member(personId).short}.png` : `ยอดค้าง-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast(personId ? `ดาวน์โหลดรูปยอดค้างของ ${member(personId).short} แล้ว` : "ดาวน์โหลดรูปสรุปยอดค้างแล้ว");
  }, "image/png");
}

function paymentsAdmin() {
  const totals = getPaymentTotals();
  const filter = state.adminFilters.payments;
  const isToday = selectedDateKey(filter.date) === localDateKey();
  const allDebtors = state.members.filter((person) => totals.byPerson[person.id] > 0 || person.previousDue > 0 || state.paymentProofs[person.id]);
  const debtors = (isToday ? allDebtors : []).filter((person) => adminSearchMatch([person.name, person.phone, membershipName(person)], filter.query)).sort((a, b) => {
    const dueA = (state.payments[a.id] ? 0 : totals.byPerson[a.id]) + a.previousDue;
    const dueB = (state.payments[b.id] ? 0 : totals.byPerson[b.id]) + b.previousDue;
    if (filter.sort === "name_asc") return a.name.localeCompare(b.name, "th");
    if (filter.sort === "paid_first") return Number(Boolean(state.payments[b.id])) - Number(Boolean(state.payments[a.id]));
    return dueB - dueA;
  });
  const received = allDebtors.filter((person) => state.payments[person.id]).reduce((sum, person) => sum + totals.byPerson[person.id], 0);
  return `
    <div class="page-heading"><div><p class="eyebrow">PAYMENT MANAGEMENT</p><h1>รายการชำระเงิน</h1><p>ดูยอดวันนี้ ตรวจหลักฐาน รับชำระ และดาวน์โหลดรูปส่งทวงต่อใน Line เดิม</p></div><div class="dashboard-heading-actions"><button class="button secondary" data-action="show-checkout-picker">↗ เช็คเอาท์คนกลับบ้าน</button><button class="button secondary" data-action="download-debt-image">⇩ ดาวน์โหลดรูปทวงเงิน</button><button class="button" data-action="mark-all-paid">✓ รับชำระทั้งหมด</button></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-icon">฿</div><strong>${formatMoney(totals.grand)}</strong><small>ยอดเรียกเก็บ</small></div>
      <div class="stat-card"><div class="stat-icon">✓</div><strong>${formatMoney(received)}</strong><small>รับแล้ว</small></div>
      <div class="stat-card"><div class="stat-icon">◷</div><strong>${formatMoney(totals.grand - received)}</strong><small>รอชำระ</small></div>
      <div class="stat-card"><div class="stat-icon">▤</div><strong>${formatMoney(totals.purchaseTotal)}</strong><small>ยอดขายน้ำ / อุปกรณ์ · ค่าระบบ ฿${formatMoney(state.ballRounds.reduce((sum, round) => sum + round.fee, 0))}</small></div>
    </div>
    <section class="panel"><div class="panel-header"><div><h2>สรุปรายคน</h2><p>พบ ${debtors.length} คน · รวมค่าลูก ค่าระบบ ค่าเข้า และรายการซื้อ</p></div></div>${adminFilterBar("payments", { sortOptions: [["amount_desc", "ยอดสูงสุด"], ["name_asc", "ชื่อ ก–ฮ"], ["paid_first", "ชำระแล้วก่อน"]] })}<div class="data-list">
      <div class="data-row head"><span>ผู้เล่น</span><span>รายการวันนี้</span><span>ยอดวันนี้</span><span>สถานะ</span></div>
      ${debtors.map((person) => {
        const games = state.ballRounds.filter((round) => round.playerIds.includes(person.id)).length;
        const paid = state.payments[person.id] && !person.previousDue;
        const proof = state.paymentProofs[person.id];
        const purchases = state.purchases.filter((purchase) => purchase.personId === person.id);
        const items = [games ? `${games} เกม` : "", totals.entryByPerson[person.id] ? `ค่าเข้า ฿${state.settings.guestEntryFee}` : "", purchases.length ? `ซื้อของ ฿${formatMoney(totals.purchaseByPerson[person.id])}` : "", person.previousDue ? `ค้างเดิม ฿${formatMoney(person.previousDue)}` : ""].filter(Boolean).join(" + ") || "ไม่มีรายการวันนี้";
        const totalDue = (state.payments[person.id] ? 0 : totals.byPerson[person.id]) + person.previousDue;
        const checkout = person.checkedIn ? `<button class="button small checkout-button" data-action="checkout" data-person="${person.id}">↗ กลับบ้าน</button>` : `<span class="badge">เช็คเอาท์แล้ว</span>`;
        const status = paid
          ? `<div class="admin-payment-action"><button class="badge success" data-action="toggle-paid" data-person="${person.id}">✓ ชำระแล้ว</button>${checkout}</div>`
          : `<div class="admin-payment-action">${proof ? `<span class="badge warning">📎 มีหลักฐาน</span>` : ""}<button class="button small secondary" data-action="download-debt-image" data-person="${person.id}" title="ดาวน์โหลดรูปยอดค้างรายคน">⇩ รูป</button><button class="button small ${proof ? "" : "coral"}" data-action="accept-player-payment" data-person="${person.id}">${proof ? "ตรวจและรับชำระ" : "รับชำระ"}</button>${checkout}</div>`;
        return `<div class="data-row"><div class="person-cell">${initialsAvatar(person)}<div><strong>${person.name}</strong><small>${membershipName(person)} · มือ ${person.level}</small></div></div><span>${items}</span><strong class="money">฿${formatMoney(totalDue)}</strong>${status}</div>`;
      }).join("") || `<div class="empty-state">ไม่พบข้อมูลตามวันที่หรือคำค้น</div>`}
    </div></section>`;
}

function peopleAdmin() {
  const filter = state.adminFilters.people;
  const people = state.members.filter((person) => adminSearchMatch([person.name, person.phone, person.level, membershipName(person)], filter.query)).sort((a, b) => {
    if (filter.sort === "level") return a.level.localeCompare(b.level) || a.name.localeCompare(b.name, "th");
    if (filter.sort === "debt_desc") return b.previousDue - a.previousDue || a.name.localeCompare(b.name, "th");
    if (filter.sort === "checked_in") return Number(b.checkedIn) - Number(a.checkedIn) || a.name.localeCompare(b.name, "th");
    return a.name.localeCompare(b.name, "th");
  });
  return `
    <div class="page-heading"><div><p class="eyebrow">MASTER สมาชิก</p><h1>สมาชิกทั้งหมด</h1><p>จัดการประเภทสมาชิก ระดับมือ และสิทธิ์การลงเล่น</p></div><button class="button" data-action="new-member">＋ เพิ่มสมาชิก</button></div>
    <section class="panel"><div class="panel-header"><div><h2>${people.length} / ${state.members.length} สมาชิก</h2><p>${checkedInMembers().length} คนอยู่ในโรงยิมตอนนี้</p></div><div class="dashboard-heading-actions"><button class="button secondary" data-action="show-checkout-picker">↗ เช็คเอาท์กลับบ้าน</button><button class="button lime checkin-primary" data-action="checkin">✓ เช็คอินสมาชิก</button></div></div>${adminFilterBar("people", { showDate: false, sortOptions: [["name_asc", "ชื่อ ก–ฮ"], ["checked_in", "เช็คอินก่อน"], ["debt_desc", "ยอดค้างสูงสุด"], ["level", "ระดับมือ"]] })}<div class="data-list">
      <div class="data-row head member-row"><span>ชื่อผู้เล่น</span><span>ประเภทสมาชิก</span><span>ระดับมือ</span><span>สถานะวันนี้</span><span>สิทธิ์พรุ่งนี้</span></div>
      ${people.map((person) => `<div class="data-row member-row ${person.previousDue ? "blocked-member" : ""}"><div class="person-cell">${initialsAvatar(person)}<div><strong>${person.name}</strong><small>${person.phone || "ไม่ระบุเบอร์โทร"}</small></div></div><div class="membership-cell"><button class="badge ${person.membership === "club" ? "club" : "guest"}" data-action="toggle-membership" data-person="${person.id}">${membershipName(person)}</button><small>${membershipDetail(person)}</small></div><button class="badge blue" data-action="cycle-level" data-person="${person.id}">มือ ${person.level}</button><div class="member-presence"><span class="badge ${person.checkedIn ? "success" : ""}">${person.checkedIn ? "เช็คอินแล้ว" : "ยังไม่มา"}</span>${person.checkedIn ? `<button class="button small checkout-button" data-action="checkout" data-person="${person.id}">↗ กลับบ้าน</button>` : ""}</div>${person.previousDue ? `<button class="badge danger overdue-action" data-action="clear-overdue" data-person="${person.id}" title="กดเมื่อรับชำระยอดค้างแล้ว">ระงับสิทธิ์ · ค้าง ฿${formatMoney(person.previousDue)}</button>` : `<span class="badge success">เล่นได้</span>`}</div>`).join("") || `<div class="empty-state">ไม่พบสมาชิกตามคำค้น</div>`}
    </div></section>`;
}

function mastersAdmin() {
  return `
    <div class="page-heading master-page-heading"><div><p class="eyebrow">SYSTEM SETTINGS · CRUD</p><h1>ตั้งค่าระบบ</h1><p>เพิ่ม แก้ไข ลบ และเปิด/ปิดข้อมูลหลักที่ทุกหน้าจอใช้งานร่วมกัน</p></div><span class="badge success">บันทึกบนเซิร์ฟเวอร์แบบ Real-time</span></div>
    <div class="settings-grid">
      <section class="panel master-panel"><div class="panel-header"><div><h2>Master สนาม</h2><p>${state.courts.length} สนาม · เปิด/ปิดได้โดยไม่ต้องลบ</p></div><button class="button small" data-action="show-master-form" data-kind="court">＋ เพิ่ม</button></div><div class="data-list">${state.courts.map((court) => `<div class="master-court"><div><strong>${court.name}</strong><small>${getPlayingQueue(court.id) ? "กำลังมีผู้เล่น" : court.active ? "เปิดใช้งาน" : "ปิดชั่วคราว"}</small></div><div class="master-actions"><button class="toggle ${court.active ? "on" : ""}" data-action="toggle-court" data-court="${court.id}" aria-label="เปิดปิด ${court.name}"></button><button class="button small secondary" data-action="show-master-form" data-kind="court" data-key="${court.id}">แก้ไข</button><button class="button small coral" data-action="show-delete-master" data-kind="court" data-key="${court.id}">ลบ</button></div></div>`).join("")}</div></section>
      <section class="panel master-panel"><div class="panel-header"><div><h2>Master ระดับมือ</h2><p>${Object.keys(LEVELS).length} ระดับ · ใช้กับสมาชิกและการจัดเกม</p></div><button class="button small" data-action="show-master-form" data-kind="level">＋ เพิ่ม</button></div><div class="data-list level-guide">${Object.entries(LEVELS).map(([code, item]) => `<div class="level-item master-level"><span class="level-big">${code}</span><div><strong>${item.label}</strong><small>${item.description}</small></div><div class="master-actions"><button class="button small secondary" data-action="show-master-form" data-kind="level" data-key="${code}">แก้ไข</button><button class="button small coral" data-action="show-delete-master" data-kind="level" data-key="${code}">ลบ</button></div></div>`).join("")}</div></section>
      <section class="panel master-panel"><div class="panel-header"><div><h2>Master ลูกแบดขนไก่</h2><p>${state.shuttles.length} ยี่ห้อ / รุ่น · เลือกได้ตอนเบิกลูก</p></div><button class="button small" data-action="show-master-form" data-kind="shuttle">＋ เพิ่ม</button></div><div class="data-list">${state.shuttles.map((item) => `<div class="master-court product-master"><div><strong>${shuttleLabel(item)}</strong><small>ราคาต่อลูก · ${item.active ? "เปิดให้เบิก" : "ปิดชั่วคราว"}</small></div><strong class="money">฿${formatMoney(item.price)}</strong><div class="master-actions"><button class="toggle ${item.active ? "on" : ""}" data-action="toggle-shuttle" data-shuttle="${item.id}" aria-label="เปิดปิด ${shuttleLabel(item)}"></button><button class="button small secondary" data-action="show-master-form" data-kind="shuttle" data-key="${item.id}">แก้ไข</button><button class="button small coral" data-action="show-delete-master" data-kind="shuttle" data-key="${item.id}">ลบ</button></div></div>`).join("")}</div></section>
      <section class="panel master-panel"><div class="panel-header"><div><h2>Master น้ำ / อุปกรณ์</h2><p>${state.products.length} รายการ · ใช้ในเมนูซื้อของ</p></div><button class="button small" data-action="show-master-form" data-kind="product">＋ เพิ่ม</button></div><div class="data-list">${state.products.map((item) => `<div class="master-court product-master"><div><strong>${item.name}</strong><small>${productCategoryName(item)} · ${item.active ? "เปิดขาย" : "ปิดขาย"}</small></div><strong class="money">฿${formatMoney(item.price)}</strong><div class="master-actions"><button class="toggle ${item.active ? "on" : ""}" data-action="toggle-product" data-product="${item.id}" aria-label="เปิดปิด ${item.name}"></button><button class="button small secondary" data-action="show-master-form" data-kind="product" data-key="${item.id}">แก้ไข</button><button class="button small coral" data-action="show-delete-master" data-kind="product" data-key="${item.id}">ลบ</button></div></div>`).join("")}</div></section>
      <section class="panel system-plan-panel"><div class="panel-header"><div><h2>ค่าระบบที่จ่ายให้ผู้พัฒนา</h2><p>เลือกใช้งานเพียง 1 รูปแบบ</p></div><span class="badge success">กำลังใช้: ${state.settings.systemChargeMode === "per_shuttle" ? "คิดต่อลูก" : "รายเดือน"}</span></div><div class="system-plan-options"><button class="system-plan-option ${state.settings.systemChargeMode === "per_shuttle" ? "selected" : ""}" type="button" data-action="select-system-charge-mode" data-mode="per_shuttle"><span class="system-plan-radio"></span><div><strong>คิดตามลูกที่เบิก</strong><small>หักส่งลูกละ ฿${formatMoney(state.settings.systemFeePerShuttle)}</small></div></button><button class="system-plan-option ${state.settings.systemChargeMode === "monthly" ? "selected" : ""}" type="button" data-action="select-system-charge-mode" data-mode="monthly"><span class="system-plan-radio"></span><div><strong>เหมาจ่ายรายเดือน</strong><small>จ่าย ฿${formatMoney(state.settings.monthlySystemFee)} ต่อเดือน</small></div></button></div><div class="system-plan-footer"><span>${state.settings.systemChargeMode === "per_shuttle" ? "ค่าระบบรวมในแต่ละเกมและหารผู้เล่น 4 คน" : "ไม่บวกค่าระบบในยอดผู้เล่นแต่ละเกม"}</span><button class="button small secondary" data-action="show-master-form" data-kind="settings">แก้จำนวนเงิน</button></div></section>
      <section class="panel"><div class="panel-header"><div><h2>อัตราสมาชิกและค่าเข้า</h2><p>ค่าบริการของชมรม</p></div><button class="button small secondary" data-action="show-master-form" data-kind="settings">แก้ไข</button></div><div class="data-list"><div class="master-court"><div><strong>ค่าเข้าบุคคลภายนอก</strong><small>คิดครั้งเดียวต่อวันที่มาเล่น</small></div><strong class="money">฿${formatMoney(state.settings.guestEntryFee)}</strong></div><div class="master-court"><div><strong>ค่าสมาชิกชมรมรายปี</strong><small>${state.settings.annualMemberFee ? "อัตราปัจจุบัน" : "ยังไม่กำหนด"}</small></div><strong>${state.settings.annualMemberFee ? `฿${formatMoney(state.settings.annualMemberFee)}` : "—"}</strong></div></div></section>
      <section class="panel"><div class="panel-header"><div><h2>ประเภทสมาชิก</h2><p>เงื่อนไขการใช้งานของชมรม</p></div></div><div class="data-list level-guide"><div class="level-item"><span class="level-big">C</span><div><strong>สมาชิกชมรม</strong><small>ชำระสมาชิกเป็นรายปี · ไม่เสียค่าเข้ารายวัน</small></div></div><div class="level-item"><span class="level-big" style="background:#ffe1dc">G</span><div><strong>บุคคลภายนอก</strong><small>เพิ่มค่าเข้า ฿${formatMoney(state.settings.guestEntryFee)} เมื่อเช็คอินครั้งแรกของวัน</small></div></div></div></section>
      <section class="panel"><div class="panel-header"><div><h2>กติกาการเล่น</h2><p>ใช้สื่อสารให้ผู้เล่นทุกคนเข้าใจตรงกัน</p></div></div><div class="data-list"><div class="callout" style="background:#edf7c8;color:#41561e">✓ เช็คอินก่อนดูและลงคิว<br>✓ บุคคลภายนอกเสียค่าเข้า ฿${formatMoney(state.settings.guestEntryFee)} ต่อวัน<br>✓ 1 คิวต้องมีผู้เล่น 4 คน<br>✓ ใครก็ได้สามารถจัดคิวลงสนามและจบเกม<br>✓ ค้างชำระข้ามวันจะถูกระงับสิทธิ์</div></div></section>
    </div>`;
}

function cleanMasterText(value) {
  return String(value || "").trim().replace(/[<>"']/g, "");
}

function showMasterForm(kind, key = null) {
  if (kind === "court") {
    const item = key ? state.courts.find((court) => court.id === Number(key)) : null;
    return openDialog(`
      <div class="dialog-header"><div><h2>${item ? "แก้ไขสนาม" : "เพิ่มสนาม"}</h2><p>ชื่อและสถานะจะแสดงบน Board, เว็บผู้เล่น และหน้า Admin</p></div><button class="dialog-close" value="cancel">×</button></div>
      <div class="dialog-body"><div class="field"><label for="masterCourtName">ชื่อสนาม</label><input id="masterCourtName" value="${item?.name || ""}" placeholder="เช่น สนาม 5" maxlength="40"></div><div class="field"><label for="masterCourtActive">สถานะ</label><select id="masterCourtActive"><option value="true" ${item?.active !== false ? "selected" : ""}>เปิดใช้งาน</option><option value="false" ${item?.active === false ? "selected" : ""}>ปิดชั่วคราว</option></select></div></div>
      <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="save-master" data-kind="court" data-key="${item?.id || ""}">${item ? "บันทึกการแก้ไข" : "เพิ่มสนาม"}</button></div>`);
  }
  if (kind === "level") {
    const item = key ? LEVELS[key] : null;
    return openDialog(`
      <div class="dialog-header"><div><h2>${item ? "แก้ไขระดับมือ" : "เพิ่มระดับมือ"}</h2><p>รหัสใช้แสดงข้างชื่อสมาชิกและช่วยจัดเกม</p></div><button class="dialog-close" value="cancel">×</button></div>
      <div class="dialog-body"><div class="field"><label for="masterLevelCode">รหัสระดับ</label><input id="masterLevelCode" value="${key || ""}" placeholder="เช่น A" maxlength="4" style="text-transform:uppercase"></div><div class="field"><label for="masterLevelLabel">ชื่อระดับ</label><input id="masterLevelLabel" value="${item?.label || ""}" placeholder="เช่น Advanced" maxlength="40"></div><div class="field"><label for="masterLevelDescription">คำอธิบาย</label><input id="masterLevelDescription" value="${item?.description || ""}" placeholder="ใช้จัดเกมระดับใกล้เคียงกัน" maxlength="100"></div></div>
      <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="save-master" data-kind="level" data-key="${key || ""}">${item ? "บันทึกการแก้ไข" : "เพิ่มระดับ"}</button></div>`);
  }
  if (kind === "shuttle") {
    const item = key ? shuttle(Number(key)) : null;
    return openDialog(`
      <div class="dialog-header"><div><h2>${item ? "แก้ไขลูกแบด" : "เพิ่มยี่ห้อลูกแบด"}</h2><p>กำหนดยี่ห้อ รุ่น และราคาต่อลูกสำหรับใช้ตอนเบิก</p></div><button class="dialog-close" value="cancel">×</button></div>
      <div class="dialog-body"><div class="master-rate-grid"><div class="field"><label for="masterShuttleBrand">ยี่ห้อ</label><input id="masterShuttleBrand" value="${item?.brand || ""}" placeholder="เช่น RSL" maxlength="40"></div><div class="field"><label for="masterShuttleModel">รุ่น</label><input id="masterShuttleModel" value="${item?.model || ""}" placeholder="เช่น Classic" maxlength="50"></div></div><div class="field"><label for="masterShuttlePrice">ราคาต่อลูก</label><input id="masterShuttlePrice" type="number" min="1" step="1" value="${item?.price ?? ""}" placeholder="0"></div><label class="master-checkbox"><input id="masterShuttleActive" type="checkbox" ${item?.active !== false ? "checked" : ""}><span>เปิดให้เลือกตอนเบิกลูกทันที</span></label></div>
      <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="save-master" data-kind="shuttle" data-key="${item?.id || ""}">${item ? "บันทึกการแก้ไข" : "เพิ่มลูกแบด"}</button></div>`);
  }
  if (kind === "product") {
    const item = key ? product(Number(key)) : null;
    return openDialog(`
      <div class="dialog-header"><div><h2>${item ? "แก้ไขสินค้า" : "เพิ่มน้ำ / อุปกรณ์"}</h2><p>รายการที่เปิดขายจะปรากฏในเมนูซื้อของ</p></div><button class="dialog-close" value="cancel">×</button></div>
      <div class="dialog-body"><div class="field"><label for="masterProductName">ชื่อสินค้า</label><input id="masterProductName" value="${item?.name || ""}" placeholder="เช่น น้ำเกลือแร่" maxlength="50"></div><div class="field"><label for="masterProductCategory">ประเภท</label><select id="masterProductCategory"><option value="drink" ${item?.category !== "equipment" ? "selected" : ""}>น้ำดื่ม</option><option value="equipment" ${item?.category === "equipment" ? "selected" : ""}>อุปกรณ์</option></select></div><div class="field"><label for="masterProductPrice">ราคา</label><input id="masterProductPrice" type="number" min="0" step="1" value="${item?.price ?? ""}" placeholder="0"></div><label class="master-checkbox"><input id="masterProductActive" type="checkbox" ${item?.active !== false ? "checked" : ""}><span>เปิดขายทันที</span></label></div>
      <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="save-master" data-kind="product" data-key="${item?.id || ""}">${item ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}</button></div>`);
  }
  if (kind === "settings") {
    return openDialog(`
      <div class="dialog-header"><div><h2>แก้ไขอัตราค่าบริการ</h2><p>ค่าที่แก้จะใช้กับรายการใหม่ ส่วนรายการเก่ายังคงราคาเดิม</p></div><button class="dialog-close" value="cancel">×</button></div>
      <div class="dialog-body"><div class="field"><label for="settingSystemChargeMode">วิธีคิดค่าระบบที่หักส่งผู้พัฒนา</label><select id="settingSystemChargeMode"><option value="per_shuttle" ${state.settings.systemChargeMode === "per_shuttle" ? "selected" : ""}>คิดตามจำนวนลูกแบดที่เบิก</option><option value="monthly" ${state.settings.systemChargeMode === "monthly" ? "selected" : ""}>เหมาจ่ายรายเดือน</option></select></div><div class="master-rate-grid"><div class="field"><label for="settingSystemFeePerShuttle">ค่าระบบ / ลูก</label><input id="settingSystemFeePerShuttle" type="number" min="0" step="1" value="${state.settings.systemFeePerShuttle}"></div><div class="field"><label for="settingMonthlySystemFee">ค่าระบบ / เดือน</label><input id="settingMonthlySystemFee" type="number" min="0" step="1" value="${state.settings.monthlySystemFee}"></div><div class="field"><label for="settingGuestFee">ค่าเข้าบุคคลภายนอก / วัน</label><input id="settingGuestFee" type="number" min="0" step="1" value="${state.settings.guestEntryFee}"></div><div class="field"><label for="settingAnnualFee">ค่าสมาชิกรายปี</label><input id="settingAnnualFee" type="number" min="0" step="1" value="${state.settings.annualMemberFee}" placeholder="0 = ยังไม่กำหนด"></div></div><div class="callout">ถ้าเลือก “คิดตามจำนวนลูก” ระบบจะรวมค่าระบบในแต่ละเกมและหาร 4 คน · ถ้าเลือก “เหมารายเดือน” จะไม่บวกค่าระบบในยอดผู้เล่น</div></div>
      <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="save-master" data-kind="settings">บันทึกอัตรา</button></div>`);
  }
}

function saveMaster(kind, key = null) {
  if (kind === "court") {
    const name = cleanMasterText(dialogContent.querySelector("#masterCourtName")?.value);
    const active = dialogContent.querySelector("#masterCourtActive")?.value === "true";
    if (!name) return showToast("กรุณากรอกชื่อสนาม");
    if (state.courts.some((court) => court.name.toLocaleLowerCase("th-TH") === name.toLocaleLowerCase("th-TH") && court.id !== Number(key))) return showToast("มีชื่อสนามนี้แล้ว");
    const current = key ? state.courts.find((court) => court.id === Number(key)) : null;
    if (current && !active && getPlayingQueue(current.id)) return showToast("จบเกมในสนามก่อนปิดใช้งาน");
    if (current) Object.assign(current, { name, active });
    else state.courts.push({ id: Math.max(0, ...state.courts.map((court) => court.id)) + 1, name, active });
  } else if (kind === "level") {
    const code = cleanMasterText(dialogContent.querySelector("#masterLevelCode")?.value).toUpperCase();
    const label = cleanMasterText(dialogContent.querySelector("#masterLevelLabel")?.value);
    const description = cleanMasterText(dialogContent.querySelector("#masterLevelDescription")?.value);
    if (!/^[A-Z0-9]{1,4}$/.test(code) || !label || !description) return showToast("กรอกรหัส A-Z/0-9 และข้อมูลระดับให้ครบ");
    if (LEVELS[code] && code !== key) return showToast("มีรหัสระดับนี้แล้ว");
    if (key && key !== code) {
      state.members.forEach((person) => { if (person.level === key) person.level = code; });
      delete LEVELS[key];
    }
    LEVELS[code] = { label, description };
  } else if (kind === "shuttle") {
    const brand = cleanMasterText(dialogContent.querySelector("#masterShuttleBrand")?.value);
    const model = cleanMasterText(dialogContent.querySelector("#masterShuttleModel")?.value);
    const price = Number(dialogContent.querySelector("#masterShuttlePrice")?.value);
    const active = Boolean(dialogContent.querySelector("#masterShuttleActive")?.checked);
    if (!brand || !model || !Number.isFinite(price) || price <= 0) return showToast("กรอกยี่ห้อ รุ่น และราคาต่อลูกให้ถูกต้อง");
    if (state.shuttles.some((item) => `${item.brand} ${item.model}`.toLocaleLowerCase("th-TH") === `${brand} ${model}`.toLocaleLowerCase("th-TH") && item.id !== Number(key))) return showToast("มียี่ห้อและรุ่นนี้แล้ว");
    const current = key ? shuttle(Number(key)) : null;
    if (current) Object.assign(current, { brand, model, price, active });
    else state.shuttles.push({ id: Math.max(0, ...state.shuttles.map((item) => item.id)) + 1, brand, model, price, active });
  } else if (kind === "product") {
    const name = cleanMasterText(dialogContent.querySelector("#masterProductName")?.value);
    const category = dialogContent.querySelector("#masterProductCategory")?.value;
    const price = Number(dialogContent.querySelector("#masterProductPrice")?.value);
    const active = Boolean(dialogContent.querySelector("#masterProductActive")?.checked);
    if (!name || !["drink", "equipment"].includes(category) || !Number.isFinite(price) || price < 0) return showToast("กรอกชื่อ ประเภท และราคาให้ถูกต้อง");
    if (state.products.some((item) => item.name.toLocaleLowerCase("th-TH") === name.toLocaleLowerCase("th-TH") && item.id !== Number(key))) return showToast("มีสินค้านี้แล้ว");
    const current = key ? product(Number(key)) : null;
    if (current) Object.assign(current, { name, category, price, active });
    else state.products.push({ id: Math.max(0, ...state.products.map((item) => item.id)) + 1, name, category, price, active });
  } else if (kind === "settings") {
    const next = {
      systemChargeMode: dialogContent.querySelector("#settingSystemChargeMode")?.value,
      systemFeePerShuttle: Number(dialogContent.querySelector("#settingSystemFeePerShuttle")?.value),
      monthlySystemFee: Number(dialogContent.querySelector("#settingMonthlySystemFee")?.value),
      guestEntryFee: Number(dialogContent.querySelector("#settingGuestFee")?.value),
      annualMemberFee: Number(dialogContent.querySelector("#settingAnnualFee")?.value),
    };
    if (!["per_shuttle", "monthly"].includes(next.systemChargeMode) || [next.systemFeePerShuttle, next.monthlySystemFee, next.guestEntryFee, next.annualMemberFee].some((value) => !Number.isFinite(value) || value < 0)) return showToast("กรุณาเลือกวิธีคิดและกรอกอัตราตั้งแต่ 0 ขึ้นไป");
    Object.assign(state.settings, next);
  } else return;
  closeDialog();
  render();
  showToast("บันทึกข้อมูลระบบแล้ว");
}

function masterName(kind, key) {
  if (kind === "court") return state.courts.find((court) => court.id === Number(key))?.name;
  if (kind === "level") return `ระดับ ${key}`;
  if (kind === "shuttle") return shuttle(Number(key)) ? shuttleLabel(shuttle(Number(key))) : null;
  if (kind === "product") return product(Number(key))?.name;
  return "รายการนี้";
}

function showDeleteMaster(kind, key) {
  const name = masterName(kind, key);
  if (!name) return showToast("ไม่พบข้อมูลที่ต้องการลบ");
  openDialog(`<div class="dialog-header"><div><h2>ลบ ${name}?</h2><p>ระบบจะตรวจสอบการใช้งานก่อนลบ เพื่อไม่ให้ข้อมูลเดิมเสีย</p></div><button class="dialog-close" value="cancel">×</button></div><div class="dialog-body"><div class="callout" style="background:#fff0ec;color:#8d4938">การลบจะมีผลกับทุกหน้าจอและย้อนกลับไม่ได้ กรุณาตรวจสอบรายการก่อนยืนยัน</div></div><div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button coral" type="button" data-action="confirm-delete-master" data-kind="${kind}" data-key="${key}">ยืนยันลบ</button></div>`);
}

function deleteMaster(kind, key) {
  if (kind === "court") {
    const id = Number(key);
    if (state.courts.length === 1) return showToast("ต้องเหลือสนามอย่างน้อย 1 สนาม");
    if (getPlayingQueue(id)) return showToast("จบเกมในสนามนี้ก่อนลบ");
    state.courts = state.courts.filter((court) => court.id !== id);
  } else if (kind === "level") {
    if (Object.keys(LEVELS).length === 1) return showToast("ต้องเหลือระดับมืออย่างน้อย 1 ระดับ");
    if (state.members.some((person) => person.level === key)) return showToast("ยังมีสมาชิกใช้ระดับนี้ กรุณาเปลี่ยนระดับสมาชิกก่อน");
    delete LEVELS[key];
  } else if (kind === "shuttle") {
    const id = Number(key);
    if (state.shuttles.length === 1) return showToast("ต้องเหลือลูกแบดอย่างน้อย 1 ยี่ห้อ");
    if (state.ballRounds.some((round) => round.shuttleId === id)) return showToast("ลูกแบดรุ่นนี้มีประวัติการเบิก จึงลบไม่ได้ ให้ปิดใช้งานแทน");
    state.shuttles = state.shuttles.filter((item) => item.id !== id);
  } else if (kind === "product") {
    const id = Number(key);
    if (state.purchases.some((purchase) => purchase.productId === id)) return showToast("สินค้านี้มีประวัติการซื้อ จึงลบไม่ได้ ให้ปิดขายแทน");
    state.products = state.products.filter((item) => item.id !== id);
  } else return;
  closeDialog();
  render();
  showToast("ลบข้อมูลแล้ว");
}

function render() {
  app.innerHTML = state.view === "board" ? boardView() : state.view === "mobile" ? mobileView() : adminView();
  document.querySelectorAll("[data-route-link]").forEach((link) => link.classList.toggle("active", link.dataset.routeLink === state.view));
  document.title = `${state.view === "board" ? "บอร์ดสนาม" : state.view === "mobile" ? "สำหรับผู้เล่น" : "ผู้ดูแล"} — Uthai Smash`;
  renderClock();
  queueRealtimeSync();
}

function showCheckinDialog() {
  const candidates = state.members.filter((person) => !person.checkedIn);
  const missingNameHelp = state.view === "admin" ? "ไม่พบชื่อ? ปิดหน้าต่างแล้วกด + เพิ่มสมาชิก" : "ไม่พบชื่อ? แจ้งแอดมินเพิ่มเข้าระบบก่อน";
  openDialog(`
    <div class="dialog-header"><div><h2>ค้นหาและเลือกชื่อเพื่อเช็คอิน</h2><p>พิมพ์ชื่อหรือเบอร์ แล้วติ๊กเลือกได้หลายคนพร้อมกัน</p></div><button class="dialog-close" value="cancel" aria-label="ปิด">×</button></div>
    <div class="dialog-body"><div class="checkin-search-box"><span>⌕</span><input class="checkin-search" type="search" aria-label="ค้นหาสมาชิกเพื่อเช็คอิน" placeholder="พิมพ์ชื่อ เบอร์โทร หรือระดับมือ" autocomplete="off"></div><div class="callout"><strong>${missingNameHelp}</strong> · บุคคลภายนอกคิดค่าเข้า ฿${state.settings.guestEntryFee} ครั้งเดียวต่อวัน · ผู้ที่ค้างยอดเดิมต้องชำระก่อน</div><div class="checkin-list">${candidates.map((person) => `<label class="checkin-row ${person.previousDue ? "blocked" : ""}" data-search="${person.name} ${person.short} ${person.phone || ""} ${person.level} ${membershipName(person)}"><input type="checkbox" name="checkinMember" value="${person.id}" ${person.previousDue ? "disabled" : ""}>${initialsAvatar(person)}<span><strong>${person.name}</strong><small>มือ ${person.level} · ${membershipName(person)}</small></span><span class="row-status badge ${person.previousDue ? "danger" : person.membership === "guest" ? "warning" : "success"}">${person.previousDue ? `ค้าง ฿${formatMoney(person.previousDue)}` : membershipDetail(person)}</span></label>`).join("") || `<div class="empty-state">ทุกคนเช็คอินแล้ว</div>`}<div class="checkin-empty empty-state" hidden>ไม่พบชื่อที่ค้นหา</div></div></div>
    <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="confirm-checkin">ยืนยันเช็คอิน</button></div>`);
}

function showMemberDialog() {
  openDialog(`
    <div class="dialog-header"><div><h2>เพิ่มสมาชิกใหม่</h2><p>เฉพาะแอดมิน · เพิ่มเข้า Master ก่อน แล้วให้ผู้เล่นเลือกเช็คอินเอง</p></div><button class="dialog-close" value="cancel">×</button></div>
    <div class="dialog-body"><div class="field"><label for="newName">ชื่อที่ใช้เรียก</label><input id="newName" placeholder="เช่น เต้ เมืองอุทัย" autocomplete="name"></div><div class="field"><label for="newPhone">เบอร์โทรศัพท์ <span class="optional-label">ไม่บังคับ</span></label><input id="newPhone" placeholder="เว้นว่างได้" inputmode="tel"></div><div class="field"><label for="newMembership">ประเภทสมาชิก</label><select id="newMembership"><option value="guest">บุคคลภายนอก · ค่าเข้า ฿${state.settings.guestEntryFee}/วัน</option><option value="club">สมาชิกชมรม · ชำระรายปี</option></select></div><div class="field"><label for="newLevel">ระดับมือเริ่มต้น</label><select id="newLevel">${Object.entries(LEVELS).map(([code, item]) => `<option value="${code}">${code} · ${item.label}</option>`).join("")}</select></div></div>
    <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="save-member">เพิ่มเข้ารายชื่อ</button></div>`);
}

function showBallRoundDialog(roundId) {
  const round = state.ballRounds.find((item) => item.id === roundId);
  if (!round) return showToast("ไม่พบเกมที่ต้องการแก้ไข");
  openDialog(`
    <div class="dialog-header"><div><h2>แก้ไขเกม #${String(round.id).padStart(2, "0")}</h2><p>แก้ผู้รับผิดชอบค่าใช้จ่าย ลูกแบด ราคา จำนวน และวันเวลาได้ทั้งหมด</p></div><button class="dialog-close" value="cancel">×</button></div>
    <div class="dialog-body ball-round-edit-body">
      <div class="field"><label>ผู้เล่น / ผู้รับผิดชอบค่าใช้จ่าย 4 ช่อง</label><div class="four-selects">${round.playerIds.map((id, index) => ballPlayerPicker(index, id, true)).join("")}</div><small class="field-help">ชื่อซ้ำได้ และระบบจะคิดค่าใช้จ่ายตามจำนวนช่องที่ชื่อนั้นปรากฏ · การแก้ประวัติเลือกสมาชิกที่เช็คเอาท์แล้วได้</small></div>
      <div class="master-rate-grid">
        <div class="field"><label for="editBallShuttle">ยี่ห้อ / รุ่นลูกแบด</label><select id="editBallShuttle">${state.shuttles.map((item) => `<option value="${item.id}" ${item.id === round.shuttleId ? "selected" : ""}>${shuttleLabel(item)}${item.active ? "" : " · ปิดใช้งาน"}</option>`).join("")}</select></div>
        <div class="field"><label for="editBallCount">จำนวนลูก</label><input id="editBallCount" type="number" min="1" step="1" value="${round.balls}"></div>
        <div class="field"><label for="editBallPrice">ราคาต่อลูก</label><input id="editBallPrice" type="number" min="0" step="0.5" value="${round.ballCost}"></div>
        <div class="field"><label for="editBallFee">ค่าระบบรวมเกมนี้</label><input id="editBallFee" type="number" min="0" step="0.5" value="${round.fee}"></div>
      </div>
      <div class="field"><label for="editBallCreatedAt">วันและเวลาที่เบิก</label><input id="editBallCreatedAt" type="datetime-local" value="${localDateTimeValue(round.createdAt)}"></div>
      <div class="callout">แก้ไขรายการนี้แล้ว ยอดรายคนและ Dashboard จะคำนวณใหม่จากข้อมูลล่าสุดทันที</div>
    </div>
    <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="save-ball-round" data-round="${round.id}">บันทึกการแก้ไข</button></div>`);
}

function saveBallRound(roundId) {
  const round = state.ballRounds.find((item) => item.id === roundId);
  if (!round) return showToast("ไม่พบเกมที่ต้องการแก้ไข");
  const playerIds = [...dialogContent.querySelectorAll(".ball-player")].map((input) => Number(input.value)).filter(Boolean);
  const selectedShuttle = shuttle(Number(dialogContent.querySelector("#editBallShuttle")?.value));
  const balls = Number(dialogContent.querySelector("#editBallCount")?.value);
  const ballCost = Number(dialogContent.querySelector("#editBallPrice")?.value);
  const fee = Number(dialogContent.querySelector("#editBallFee")?.value);
  const createdAt = new Date(dialogContent.querySelector("#editBallCreatedAt")?.value).getTime();
  if (playerIds.length !== 4) return showToast("กรุณาเลือกชื่อให้ครบ 4 ช่อง");
  if (!selectedShuttle) return showToast("กรุณาเลือกลูกแบด");
  if (!Number.isInteger(balls) || balls < 1 || [ballCost, fee].some((value) => !Number.isFinite(value) || value < 0)) return showToast("กรุณากรอกจำนวนและราคาให้ถูกต้อง");
  if (!Number.isFinite(createdAt)) return showToast("กรุณาเลือกวันและเวลา");
  Object.assign(round, { playerIds, balls, shuttleId: selectedShuttle.id, shuttleName: shuttleLabel(selectedShuttle), ballCost, fee, createdAt });
  playerIds.forEach((personId) => { state.payments[personId] = false; });
  closeDialog();
  render();
  showToast(`บันทึกการแก้ไขเกม #${String(round.id).padStart(2, "0")} แล้ว`);
}

function showDeleteBallRound(roundId) {
  const round = state.ballRounds.find((item) => item.id === roundId);
  if (!round) return showToast("ไม่พบเกมที่ต้องการลบ");
  openDialog(`<div class="dialog-header"><div><h2>ลบเกม #${String(round.id).padStart(2, "0")}?</h2><p>${round.playerIds.map((id) => member(id)?.short || "ไม่พบชื่อ").join(" · ")} · ${round.shuttleName}</p></div><button class="dialog-close" value="cancel">×</button></div><div class="dialog-body"><div class="callout" style="background:#fff0ec;color:#8d4938">ยอดค่าลูกของผู้เล่นและตัวเลขใน Dashboard จะถูกคำนวณใหม่หลังลบรายการ</div></div><div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button coral" type="button" data-action="confirm-delete-ball-round" data-round="${round.id}">ยืนยันลบเกม</button></div>`);
}

function deleteBallRound(roundId) {
  const round = state.ballRounds.find((item) => item.id === roundId);
  if (!round) return showToast("ไม่พบเกมที่ต้องการลบ");
  state.ballRounds = state.ballRounds.filter((item) => item.id !== roundId);
  closeDialog();
  render();
  showToast(`ลบเกม #${String(roundId).padStart(2, "0")} แล้ว`);
}

function showPurchaseDialog(purchaseId) {
  const purchase = state.purchases.find((item) => item.id === purchaseId);
  if (!purchase) return showToast("ไม่พบรายการซื้อที่ต้องการแก้ไข");
  openDialog(`
    <div class="dialog-header"><div><h2>แก้ไขรายการซื้อ #${String(purchase.id).padStart(3, "0")}</h2><p>แก้ผู้ซื้อ สินค้า จำนวน ราคา และวันเวลาได้</p></div><button class="dialog-close" value="cancel">×</button></div>
    <div class="dialog-body">
      <div class="field"><label>ผู้ซื้อ</label>${memberSearchPicker({ hiddenId: "editPurchasePerson", action: "pick-shop-person", people: state.members, selectedId: purchase.personId, placeholder: "พิมพ์ชื่อหรือเบอร์ หรือกดเพื่อเลือก" })}</div>
      <div class="master-rate-grid">
        <div class="field"><label for="editPurchaseProduct">สินค้า</label><select id="editPurchaseProduct">${state.products.map((item) => `<option value="${item.id}" ${item.id === purchase.productId ? "selected" : ""}>${item.name}${item.active ? "" : " · ปิดขาย"}</option>`).join("")}</select></div>
        <div class="field"><label for="editPurchaseQuantity">จำนวน</label><input id="editPurchaseQuantity" type="number" min="1" step="1" value="${purchase.quantity}"></div>
        <div class="field"><label for="editPurchasePrice">ราคาต่อหน่วย</label><input id="editPurchasePrice" type="number" min="0" step="0.5" value="${purchase.unitPrice}"></div>
        <div class="field"><label for="editPurchaseCreatedAt">วันและเวลาที่ซื้อ</label><input id="editPurchaseCreatedAt" type="datetime-local" value="${localDateTimeValue(purchase.createdAt)}"></div>
      </div>
      <div class="callout">หลังบันทึก ยอดของผู้ซื้อ รายการชำระเงิน และ Dashboard จะคำนวณใหม่ทันที</div>
    </div>
    <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="save-purchase" data-purchase="${purchase.id}">บันทึกการแก้ไข</button></div>`);
}

function savePurchase(purchaseId) {
  const purchase = state.purchases.find((item) => item.id === purchaseId);
  if (!purchase) return showToast("ไม่พบรายการซื้อที่ต้องการแก้ไข");
  const personId = Number(dialogContent.querySelector("#editPurchasePerson")?.value);
  const productId = Number(dialogContent.querySelector("#editPurchaseProduct")?.value);
  const quantity = Number(dialogContent.querySelector("#editPurchaseQuantity")?.value);
  const unitPrice = Number(dialogContent.querySelector("#editPurchasePrice")?.value);
  const createdAt = new Date(dialogContent.querySelector("#editPurchaseCreatedAt")?.value).getTime();
  if (!member(personId)) return showToast("กรุณาเลือกผู้ซื้อ");
  if (!product(productId)) return showToast("กรุณาเลือกสินค้า");
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) return showToast("กรุณากรอกจำนวนและราคาให้ถูกต้อง");
  if (!Number.isFinite(createdAt)) return showToast("กรุณาเลือกวันและเวลา");
  Object.assign(purchase, { personId, productId, quantity, unitPrice, createdAt });
  state.payments[personId] = false;
  closeDialog();
  render();
  showToast(`บันทึกการแก้ไขรายการ #${String(purchase.id).padStart(3, "0")} แล้ว`);
}

function showDeletePurchase(purchaseId) {
  const purchase = state.purchases.find((item) => item.id === purchaseId);
  if (!purchase) return showToast("ไม่พบรายการซื้อที่ต้องการลบ");
  openDialog(`<div class="dialog-header"><div><h2>ลบรายการซื้อ #${String(purchase.id).padStart(3, "0")}?</h2><p>${member(purchase.personId)?.name || "ไม่พบชื่อ"} · ${product(purchase.productId)?.name || "ไม่พบสินค้า"} × ${purchase.quantity}</p></div><button class="dialog-close" value="cancel">×</button></div><div class="dialog-body"><div class="callout" style="background:#fff0ec;color:#8d4938">ยอดซื้อของผู้เล่นและตัวเลขใน Dashboard จะถูกคำนวณใหม่หลังลบรายการ</div></div><div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button coral" type="button" data-action="confirm-delete-purchase" data-purchase="${purchase.id}">ยืนยันลบรายการ</button></div>`);
}

function deletePurchase(purchaseId) {
  if (!state.purchases.some((item) => item.id === purchaseId)) return showToast("ไม่พบรายการซื้อที่ต้องการลบ");
  state.purchases = state.purchases.filter((item) => item.id !== purchaseId);
  closeDialog();
  render();
  showToast(`ลบรายการซื้อ #${String(purchaseId).padStart(3, "0")} แล้ว`);
}

function showQueueDialog() {
  const players = availableMembers();
  openDialog(`
    <div class="dialog-header"><div><h2>สร้างคิวใหม่</h2><p>เลือกผู้เล่นว่างให้ครบ 4 คน</p></div><button class="dialog-close" value="cancel">×</button></div>
    <div class="dialog-body"><div class="four-selects">${[0,1,2,3].map((index) => `<div class="field"><label>คนที่ ${index + 1}</label><select class="queue-player"><option value="">เลือกผู้เล่น</option>${players.map((person) => `<option value="${person.id}">${person.name} · ${person.level}</option>`).join("")}</select></div>`).join("")}</div></div>
    <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="confirm-queue">ยืนยันลงคิว</button></div>`);
}

function showAssignDialog(queueId) {
  const queue = state.queues.find((item) => item.id === queueId);
  const freeCourts = state.courts.filter((court) => court.active && !getPlayingQueue(court.id));
  openDialog(`
    <div class="dialog-header"><div><h2>จัด ${queue.code} ลงสนาม</h2><p>${personNames(queue)}</p></div><button class="dialog-close" value="cancel">×</button></div>
    <div class="dialog-body">${freeCourts.length ? `<div class="radio-cards">${freeCourts.map((court, index) => `<label class="radio-card"><input type="radio" name="court" value="${court.id}" ${index === 0 ? "checked" : ""}><span><strong>${court.name}</strong><small>ว่างและพร้อมเริ่มเกม</small></span></label>`).join("")}</div>` : `<div class="callout">ตอนนี้ทุกสนามกำลังใช้งาน กรุณาจบเกมในสนามก่อน</div>`}</div>
    <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button" type="button" data-action="confirm-assign" data-queue="${queue.id}" ${freeCourts.length ? "" : "disabled"}>เริ่มเกม</button></div>`);
}

function showFinishDialog(queueId) {
  const queue = state.queues.find((item) => item.id === queueId);
  openDialog(`
    <div class="dialog-header"><div><h2>จบเกม ${queue.code}?</h2><p>สนาม ${queue.courtId} จะกลับเป็นสถานะว่างทันที</p></div><button class="dialog-close" value="cancel">×</button></div>
    <div class="dialog-body"><div class="callout" style="background:#edf7c8;color:#41561e">เล่นมาแล้ว ${minutesSince(queue.startedAt)} นาที · ${personNames(queue)}</div><p style="font-size:13px;color:var(--muted)">การจบเกมไม่เบิกลูกอัตโนมัติ เพราะ flow เบิกลูกแยกจากระบบคิว</p></div>
    <div class="dialog-footer"><button class="button secondary" value="cancel">เล่นต่อ</button><button class="button coral" type="button" data-action="confirm-finish" data-queue="${queue.id}">ยืนยันจบเกม</button></div>`);
}

function showRequeueDialog(queueId) {
  const queue = state.queues.find((item) => item.id === queueId);
  if (!queue || queue.status !== "playing") return showToast("คิวนี้ไม่ได้อยู่ในสนามแล้ว");
  openDialog(`
    <div class="dialog-header"><div><h2>คืน ${queue.code} กลับไปรอคิว?</h2><p>สนาม ${queue.courtId} จะว่างทันที และเรียกคิวถัดไปลงสนามได้</p></div><button class="dialog-close" value="cancel">×</button></div>
    <div class="dialog-body"><div class="callout">${personNames(queue)} · ทีมเดิมจะกลับไปต่อท้ายแถวรอ โดยไม่ถือว่าจบเกม</div></div>
    <div class="dialog-footer"><button class="button secondary" value="cancel">เล่นต่อ</button><button class="button" type="button" data-action="confirm-requeue" data-queue="${queue.id}">ยืนยันคืนไปรอคิว</button></div>`);
}

function showCheckoutPickerDialog() {
  const people = checkedInMembers();
  openDialog(`
    <div class="dialog-header"><div><h2>เช็คเอาท์คนกลับบ้าน</h2><p>ใครก็ช่วยเลือกชื่อคนที่กลับแล้วออกจากโรงยิมได้</p></div><button class="dialog-close" value="cancel">×</button></div>
    <div class="dialog-body"><div class="field"><label>ค้นหาชื่อหรือเบอร์โทร</label>${memberSearchPicker({ hiddenId: "checkoutPersonSelect", action: "pick-checkout-person", people, placeholder: "พิมพ์ชื่อหรือกดเพื่อเลือกคนที่อยู่ในโรงยิม" })}</div><div class="callout">ถ้าอยู่ในคิวรอ ระบบจะยกเลิกคิวนั้นเพื่อไม่ให้เหลือคิวที่ผู้เล่นไม่ครบ 4 คน · ถ้ากำลังเล่นต้องจบเกมก่อน</div></div>
    <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button coral" type="button" data-action="checkout-selected">เลือกชื่อนี้กลับบ้าน</button></div>`);
}

function showCheckoutDialog(personId) {
  const person = member(personId);
  if (!person?.checkedIn) return showToast("ชื่อนี้เช็คเอาท์แล้ว");
  const playingQueue = state.queues.find((queue) => queue.status === "playing" && queue.playerIds.includes(personId));
  const waitingQueue = state.queues.find((queue) => queue.status === "waiting" && queue.playerIds.includes(personId));
  openDialog(`
    <div class="dialog-header"><div><h2>เช็กเอาท์ ${person.short}?</h2><p>ใช้เมื่อผู้เล่นกลับบ้านแล้ว เพื่อไม่ให้คนอื่นจับลงคิว</p></div><button class="dialog-close" value="cancel">×</button></div>
    <div class="dialog-body"><div class="person-cell checkout-person">${initialsAvatar(person)}<div><strong>${person.name}</strong><small>มือ ${person.level} · ${playingQueue ? `กำลังเล่นสนาม ${playingQueue.courtId}` : waitingQueue ? `อยู่ในคิว ${waitingQueue.code}` : "สถานะว่าง"}</small></div></div>${playingQueue ? `<div class="callout checkout-blocked">ยังเช็คเอาท์ไม่ได้ · กรุณาจบเกมสนาม ${playingQueue.courtId} ก่อน</div>` : waitingQueue ? `<div class="callout">คิว ${waitingQueue.code} จะถูกยกเลิกทั้งทีม เพราะผู้เล่นไม่ครบ 4 คน</div>` : ""}</div>
    <div class="dialog-footer"><button class="button secondary" value="cancel">ยกเลิก</button><button class="button coral" type="button" data-action="confirm-checkout" data-person="${person.id}" ${playingQueue ? "disabled" : ""}>ยืนยันกลับบ้าน</button></div>`);
}

function createQueue(ids) {
  if (ids.length !== 4 || new Set(ids).size !== 4) return showToast("กรุณาเลือกผู้เล่น 4 คนไม่ซ้ำกัน");
  const availableIds = new Set(availableMembers().map((person) => person.id));
  if (ids.some((id) => !availableIds.has(id))) return showToast("มีผู้เล่นบางคนถูกลงคิวไปแล้ว กรุณาเลือกใหม่");
  const id = Math.max(0, ...state.queues.map((queue) => queue.id)) + 1;
  state.queues.push({ id, code: nextQueueCode(), playerIds: ids, status: "waiting", courtId: null, createdAt: Date.now() });
  state.selectedPlayers = [];
  if (dialog.open) closeDialog();
  render();
  showToast(`ลงคิว ${state.queues.at(-1).code} เรียบร้อยแล้ว`);
}

function handleAction(button) {
  const action = button.dataset.action;
  if (action === "select-player-profile") {
    const selectedId = Number(app.querySelector("#playerIdentitySelect")?.value);
    if (!selectedId || !member(selectedId)) return showToast("กรุณาเลือกชื่อตัวเองก่อน");
    state.currentPlayerId = selectedId;
    state.selectedPlayers = [];
    render();
    showToast(`เลือกผู้ใช้งาน ${member(selectedId).name} แล้ว`);
  }
  if (action === "switch-player-profile") {
    state.currentPlayerId = null;
    state.selectedPlayers = [];
    render();
  }
  if (action === "admin-logout") {
    state.adminUnlocked = false;
    sessionStorage.removeItem("uthai-admin-unlocked");
    render();
    showToast("ออกจากระบบผู้ดูแลแล้ว");
  }
  if (action === "self-checkin") selfCheckin();
  if (action === "submit-payment-proof") submitPaymentProof();
  if (action === "checkin") {
    if (state.view === "mobile" && !state.currentPlayerId) return showToast("กรุณาเลือกชื่อตัวเองก่อน");
    showCheckinDialog();
  }
  if (action === "new-member") {
    if (state.view !== "admin") return showToast("สมาชิกใหม่กรุณาแจ้งแอดมินเพิ่มรายชื่อก่อน");
    showMemberDialog();
  }
  if (action === "open-queue") showQueueDialog();
  if (action === "show-checkout-picker") showCheckoutPickerDialog();
  if (action === "checkout-selected") {
    const id = Number(dialogContent.querySelector("#checkoutPersonSelect")?.value);
    if (!id || !member(id)) return showToast("กรุณาเลือกชื่อคนที่กลับบ้าน");
    closeDialog();
    showCheckoutDialog(id);
  }
  if (action === "checkout") showCheckoutDialog(Number(button.dataset.person));
  if (action === "confirm-checkout") checkoutMember(Number(button.dataset.person));
  if (action === "assign") button.dataset.court ? assignQueue(Number(button.dataset.queue), Number(button.dataset.court)) : showAssignDialog(Number(button.dataset.queue));
  if (action === "requeue") showRequeueDialog(Number(button.dataset.queue));
  if (action === "confirm-requeue") requeuePlayingQueue(Number(button.dataset.queue));
  if (action === "finish") showFinishDialog(Number(button.dataset.queue));
  if (action === "confirm-finish") finishQueue(Number(button.dataset.queue));
  if (action === "confirm-assign") {
    const selected = dialogContent.querySelector("input[name='court']:checked");
    if (selected) assignQueue(Number(button.dataset.queue), Number(selected.value));
  }
  if (action === "toggle-player") toggleSelectedPlayer(Number(button.dataset.person));
  if (action === "clear-selection") { state.selectedPlayers = []; render(); }
  if (action === "create-queue") createQueue(state.selectedPlayers);
  if (action === "confirm-queue") createQueue([...dialogContent.querySelectorAll(".queue-player")].map((select) => Number(select.value)).filter(Boolean));
  if (action === "confirm-checkin") {
    const ids = [...dialogContent.querySelectorAll("input[name='checkinMember']:checked")].map((input) => Number(input.value));
    if (!ids.length) return showToast("เลือกสมาชิกอย่างน้อย 1 คน");
    const newGuestFees = ids.filter((id) => member(id).membership === "guest" && !visitedToday(member(id))).length;
    ids.forEach((id) => {
      const person = member(id);
      const hasEntryFee = person.membership === "guest" && !visitedToday(person);
      person.checkedIn = true;
      person.visitedToday = true;
      if (hasEntryFee) state.payments[id] = false;
    });
    closeDialog(); render(); showToast(`เช็คอิน ${ids.length} คน${newGuestFees ? ` · เพิ่มค่าเข้า ฿${newGuestFees * state.settings.guestEntryFee}` : ""}`);
  }
  if (action === "save-member") saveNewMember();
  if (action === "set-ball-mode") {
    state.ballAdminMode = button.dataset.mode === "add" ? "add" : "list";
    render();
  }
  if (action === "issue-ball") issueBallRound();
  if (action === "edit-ball-round") showBallRoundDialog(Number(button.dataset.round));
  if (action === "save-ball-round") saveBallRound(Number(button.dataset.round));
  if (action === "show-delete-ball-round") showDeleteBallRound(Number(button.dataset.round));
  if (action === "confirm-delete-ball-round") deleteBallRound(Number(button.dataset.round));
  if (action === "set-shop-mode") {
    state.shopAdminMode = button.dataset.mode === "add" ? "add" : "list";
    render();
  }
  if (action === "record-purchase") recordPurchase();
  if (action === "edit-purchase") showPurchaseDialog(Number(button.dataset.purchase));
  if (action === "save-purchase") savePurchase(Number(button.dataset.purchase));
  if (action === "show-delete-purchase") showDeletePurchase(Number(button.dataset.purchase));
  if (action === "confirm-delete-purchase") deletePurchase(Number(button.dataset.purchase));
  if (action === "download-debt-image") downloadDebtImage(Number(button.dataset.person) || null);
  if (action === "goto-admin") { state.adminTab = button.dataset.tab; render(); }
  if (action === "set-dashboard-period") {
    const period = button.dataset.period;
    if (!["day", "month", "year"].includes(period)) return;
    state.dashboardPeriod = period;
    render();
  }
  if (action === "show-master-form") showMasterForm(button.dataset.kind, button.dataset.key || null);
  if (action === "save-master") saveMaster(button.dataset.kind, button.dataset.key || null);
  if (action === "show-delete-master") showDeleteMaster(button.dataset.kind, button.dataset.key);
  if (action === "confirm-delete-master") deleteMaster(button.dataset.kind, button.dataset.key);
  if (action === "select-system-charge-mode") {
    const mode = button.dataset.mode;
    if (!["per_shuttle", "monthly"].includes(mode)) return;
    state.settings.systemChargeMode = mode;
    render();
    showToast(mode === "per_shuttle" ? `เปลี่ยนเป็นคิดค่าระบบลูกละ ฿${formatMoney(state.settings.systemFeePerShuttle)}` : `เปลี่ยนเป็นค่าระบบรายเดือน ฿${formatMoney(state.settings.monthlySystemFee)}`);
  }
  if (action === "clear-admin-filter") {
    const page = button.dataset.page;
    if (!state.adminFilters[page]) return;
    state.adminFilters[page].query = "";
    if ("date" in state.adminFilters[page]) state.adminFilters[page].date = "today";
    render();
  }
  if (action === "toggle-picker") {
    const picker = button.closest(".player-picker");
    document.querySelectorAll(".player-picker.open").forEach((item) => { if (item !== picker) closePlayerPicker(item); });
    picker.classList.toggle("open");
    const search = picker.querySelector(".ball-player-search");
    search.setAttribute("aria-expanded", String(picker.classList.contains("open")));
    search.focus();
  }
  if (action === "pick-ball-player") {
    const person = member(Number(button.dataset.person));
    const picker = button.closest(".player-picker");
    picker.querySelector(".ball-player").value = person.id;
    picker.querySelector(".ball-player-search").value = `${person.name} · มือ ${person.level}`;
    closePlayerPicker(picker);
  }
  if (action === "pick-player-identity" || action === "pick-shop-person" || action === "pick-checkout-person") {
    const person = member(Number(button.dataset.person));
    const picker = button.closest(".player-picker");
    picker.querySelector(".picker-value").value = person.id;
    picker.querySelector(".ball-player-search").value = `${person.name} · มือ ${person.level}`;
    closePlayerPicker(picker);
  }
  if (action === "clear-overdue") {
    const person = member(Number(button.dataset.person));
    const paid = person.previousDue;
    person.previousDue = 0;
    render();
    showToast(`รับยอดค้างจาก ${person.short} ฿${formatMoney(paid)} แล้ว`);
  }
  if (action === "accept-player-payment") {
    const id = Number(button.dataset.person);
    const person = member(id);
    const paid = (state.payments[id] ? 0 : getPaymentTotals().byPerson[id]) + person.previousDue;
    state.payments[id] = true;
    person.previousDue = 0;
    delete state.paymentProofs[id];
    render();
    showToast(`ยืนยันรับชำระจาก ${person.short} ฿${formatMoney(paid)} แล้ว`);
  }
  if (action === "toggle-paid") { const id = Number(button.dataset.person); state.payments[id] = !state.payments[id]; render(); showToast(state.payments[id] ? `รับชำระจาก ${member(id).short} แล้ว` : `ยกเลิกสถานะชำระของ ${member(id).short}`); }
  if (action === "mark-all-paid") { Object.keys(getPaymentTotals().byPerson).forEach((id) => { if (getPaymentTotals().byPerson[id] > 0) state.payments[id] = true; }); render(); showToast("รับชำระครบทุกคนแล้ว"); }
  if (action === "cycle-level") { const person = member(Number(button.dataset.person)); const levels = Object.keys(LEVELS); person.level = levels[(levels.indexOf(person.level) + 1) % levels.length]; render(); showToast(`ปรับ ${person.short} เป็นมือ ${person.level}`); }
  if (action === "toggle-membership") { const person = member(Number(button.dataset.person)); person.membership = person.membership === "club" ? "guest" : "club"; render(); showToast(`ปรับ ${person.short} เป็น${membershipName(person)}`); }
  if (action === "toggle-court") { const court = state.courts.find((item) => item.id === Number(button.dataset.court)); if (!court) return; if (getPlayingQueue(court.id)) return showToast("จบเกมในสนามก่อนปิดใช้งาน"); court.active = !court.active; render(); showToast(`${court.name} ${court.active ? "เปิดใช้งาน" : "ปิดชั่วคราว"}`); }
  if (action === "toggle-shuttle") { const item = shuttle(Number(button.dataset.shuttle)); if (!item) return; item.active = !item.active; render(); showToast(`${shuttleLabel(item)} ${item.active ? "เปิดให้เบิก" : "ปิดชั่วคราว"}`); }
  if (action === "toggle-product") { const item = product(Number(button.dataset.product)); if (!item) return; item.active = !item.active; render(); showToast(`${item.name} ${item.active ? "เปิดขาย" : "ปิดขาย"}`); }
}

function selfCheckin() {
  const person = member(state.currentPlayerId);
  if (!person) return showToast("กรุณาเลือกชื่อตัวเองก่อน");
  if (person.previousDue) return showToast("ยังเช็คอินไม่ได้ กรุณาชำระยอดค้างก่อน");
  if (person.checkedIn) return showToast("ชื่อนี้เช็คอินแล้ว");
  const hasEntryFee = person.membership === "guest" && !visitedToday(person);
  person.checkedIn = true;
  person.visitedToday = true;
  if (hasEntryFee) state.payments[person.id] = false;
  render();
  showToast(`เช็คอิน ${person.name} แล้ว${hasEntryFee ? ` · ค่าเข้า ฿${state.settings.guestEntryFee}` : ""}`);
}

function submitPaymentProof() {
  const person = member(state.currentPlayerId);
  const file = app.querySelector("#paymentProof")?.files?.[0];
  if (!person) return showToast("กรุณาเลือกชื่อตัวเองก่อน");
  if (!file) return showToast("กรุณาเลือกไฟล์หลักฐานก่อนส่ง");
  const totals = getPaymentTotals();
  const outstanding = (state.payments[person.id] ? 0 : totals.byPerson[person.id]) + person.previousDue;
  if (outstanding <= 0) return showToast("ตอนนี้ไม่มียอดที่ต้องชำระ");
  state.paymentProofs[person.id] = { submittedAt: Date.now() };
  render();
  showToast("ส่งหลักฐานแล้ว · รอแอดมินตรวจสอบ");
}

function toggleSelectedPlayer(id) {
  if (state.selectedPlayers.includes(id)) state.selectedPlayers = state.selectedPlayers.filter((item) => item !== id);
  else if (state.selectedPlayers.length < 4) state.selectedPlayers.push(id);
  else return showToast("เลือกผู้เล่นได้ 4 คนต่อคิว");
  render();
}

function checkoutMember(id) {
  const person = member(id);
  if (!person?.checkedIn) return showToast("ชื่อนี้เช็คเอาท์แล้ว");
  if (state.queues.some((queue) => queue.status === "playing" && queue.playerIds.includes(id))) return showToast("ผู้เล่นกำลังอยู่ในสนาม กรุณาจบเกมก่อน");
  const cancelledQueues = state.queues.filter((queue) => queue.status === "waiting" && queue.playerIds.includes(id));
  cancelledQueues.forEach((queue) => { queue.status = "cancelled"; queue.cancelledAt = Date.now(); });
  person.visitedToday = true;
  person.checkedIn = false;
  state.selectedPlayers = state.selectedPlayers.filter((personId) => personId !== id);
  if (dialog.open) closeDialog();
  render();
  showToast(`เช็กเอาท์ ${person.short} แล้ว${cancelledQueues.length ? ` · ยกเลิก ${cancelledQueues.map((queue) => queue.code).join(", ")}` : ""}`);
}

function assignQueue(queueId, courtId) {
  if (getPlayingQueue(courtId)) return showToast("สนามนี้ไม่ว่างแล้ว");
  const queue = state.queues.find((item) => item.id === queueId);
  queue.status = "playing"; queue.courtId = courtId; queue.startedAt = Date.now();
  closeDialog(); render(); showToast(`${queue.code} เริ่มเล่นที่สนาม ${courtId}`);
}

function finishQueue(queueId) {
  const queue = state.queues.find((item) => item.id === queueId);
  queue.status = "done"; queue.finishedAt = Date.now();
  closeDialog(); render(); showToast(`${queue.code} จบเกมและคืนสนามแล้ว`);
}

function requeuePlayingQueue(queueId) {
  const queue = state.queues.find((item) => item.id === queueId);
  if (!queue || queue.status !== "playing") return showToast("คิวนี้ไม่ได้อยู่ในสนามแล้ว");
  const courtId = queue.courtId;
  queue.status = "waiting";
  queue.courtId = null;
  queue.createdAt = Date.now();
  delete queue.startedAt;
  state.queues = state.queues.filter((item) => item.id !== queueId);
  state.queues.push(queue);
  closeDialog();
  render();
  showToast(`${queue.code} กลับไปต่อท้ายคิวแล้ว · สนาม ${courtId} ว่าง`);
}

function saveNewMember() {
  if (state.view !== "admin") return showToast("เฉพาะแอดมินเท่านั้นที่เพิ่มสมาชิกใหม่ได้");
  const name = dialogContent.querySelector("#newName").value.trim();
  const phone = dialogContent.querySelector("#newPhone").value.trim();
  const level = dialogContent.querySelector("#newLevel").value;
  const membership = dialogContent.querySelector("#newMembership").value;
  if (!name) return showToast("กรุณากรอกชื่อสมาชิก");
  const id = Math.max(0, ...state.members.map((person) => person.id)) + 1;
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  state.members.push({ id, name, short: name.split(/\s+/)[0], initials, level, membership, checkedIn: false, visitedToday: false, phone, previousDue: 0 });
  closeDialog(); render(); showToast(`เพิ่ม ${name} แล้ว · ให้ผู้เล่นเลือกชื่อเพื่อเช็คอินเอง`);
}

function issueBallRound() {
  const ids = [...app.querySelectorAll(".ball-player")].map((input) => Number(input.value)).filter(Boolean);
  if (ids.length !== 4) return showToast("กรุณาเลือกชื่อให้ครบ 4 ช่อง");
  if (ids.some((id) => !canPlay(member(id)))) return showToast("มีผู้เล่นค้างชำระหรือยังไม่เช็คอิน จึงเบิกลูกไม่ได้");
  const balls = Number(app.querySelector("#ballCount").value);
  const selectedShuttle = shuttle(Number(app.querySelector("#ballShuttle")?.value));
  if (!selectedShuttle?.active) return showToast("กรุณาเลือกยี่ห้อลูกแบดที่เปิดใช้งาน");
  const id = Math.max(0, ...state.ballRounds.map((round) => round.id)) + 1;
  const fee = systemFeeForRound(balls);
  state.ballRounds.push({ id, playerIds: ids, balls, shuttleId: selectedShuttle.id, shuttleName: shuttleLabel(selectedShuttle), ballCost: selectedShuttle.price, fee, createdAt: Date.now() });
  ids.forEach((personId) => { state.payments[personId] = false; });
  state.ballAdminMode = "list";
  render();
  showToast(`บันทึกเกม #${String(id).padStart(2, "0")} · ${shuttleLabel(selectedShuttle)} · ช่องละ ฿${formatMoney((balls * selectedShuttle.price + fee) / 4)}`);
}

function recordPurchase() {
  const personId = Number(app.querySelector("#shopPerson")?.value);
  const productId = Number(app.querySelector("#shopProduct")?.value);
  const quantity = Number(app.querySelector("#shopQuantity")?.value);
  const buyer = member(personId);
  const item = product(productId);
  if (!buyer) return showToast("กรุณาเลือกชื่อผู้ซื้อ");
  if (!item?.active || quantity < 1) return showToast("กรุณาเลือกสินค้าและจำนวน");
  const id = Math.max(0, ...state.purchases.map((purchase) => purchase.id)) + 1;
  state.purchases.push({ id, personId, productId, quantity, unitPrice: item.price, createdAt: Date.now() });
  state.payments[personId] = false;
  state.shopAdminMode = "list";
  render();
  showToast(`บันทึก ${buyer.short} ซื้อ ${item.name} × ${quantity} · ฿${formatMoney(item.price * quantity)}`);
}

function closePlayerPicker(picker) {
  picker.classList.remove("open");
  picker.querySelector(".ball-player-search")?.setAttribute("aria-expanded", "false");
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".player-picker")) document.querySelectorAll(".player-picker.open").forEach(closePlayerPicker);
  const adminButton = event.target.closest("[data-admin-tab]");
  if (adminButton) { state.adminTab = adminButton.dataset.adminTab; return render(); }
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) handleAction(actionButton);
});

document.addEventListener("focusin", (event) => {
  const search = event.target.closest(".ball-player-search");
  if (!search) return;
  const picker = search.closest(".player-picker");
  document.querySelectorAll(".player-picker.open").forEach((item) => { if (item !== picker) closePlayerPicker(item); });
  picker.classList.add("open");
  search.setAttribute("aria-expanded", "true");
});

document.addEventListener("input", (event) => {
  const checkinSearch = event.target.closest(".checkin-search");
  if (checkinSearch) {
    const query = checkinSearch.value.trim().toLocaleLowerCase("th-TH");
    const rows = [...dialogContent.querySelectorAll(".checkin-row")];
    let visible = 0;
    rows.forEach((row) => {
      const matches = row.dataset.search.toLocaleLowerCase("th-TH").includes(query);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    const empty = dialogContent.querySelector(".checkin-empty");
    if (empty) empty.hidden = visible > 0;
    return;
  }
  const search = event.target.closest(".ball-player-search");
  if (!search) return;
  const picker = search.closest(".player-picker");
  const query = search.value.trim().toLocaleLowerCase("th-TH");
  let visible = 0;
  const valueInput = picker.querySelector(".picker-value");
  if (valueInput) valueInput.value = "";
  picker.classList.add("open");
  search.setAttribute("aria-expanded", "true");
  picker.querySelectorAll(".picker-option").forEach((option) => {
    const matches = option.dataset.search.toLocaleLowerCase("th-TH").includes(query);
    option.hidden = !matches;
    if (matches) visible += 1;
  });
  picker.querySelector(".picker-empty").hidden = visible > 0;
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "adminLoginForm") {
    event.preventDefault();
    attemptAdminLogin();
    return;
  }
  const form = event.target.closest("[data-admin-filter-form]");
  if (!form) return;
  event.preventDefault();
  const page = form.dataset.adminFilterForm;
  const filter = state.adminFilters[page];
  if (!filter) return;
  const data = new FormData(form);
  filter.query = cleanMasterText(data.get("query"));
  filter.sort = String(data.get("sort") || filter.sort);
  if ("date" in filter) filter.date = String(data.get("date") || "today");
  render();
});

document.addEventListener("change", (event) => {
  if (event.target.id === "ballCount" || event.target.id === "ballShuttle") {
    const balls = Number(app.querySelector("#ballCount")?.value || 1);
    const selectedShuttle = shuttle(Number(app.querySelector("#ballShuttle")?.value));
    if (!selectedShuttle) return;
    const fee = systemFeeForRound(balls);
    const preview = document.querySelector("#costPreview");
    if (preview) preview.innerHTML = `<div class="cost-line"><span>${shuttleLabel(selectedShuttle)} × ${balls}</span><strong class="money">฿${formatMoney(balls * selectedShuttle.price)}</strong></div><div class="cost-line"><span>ค่าระบบ · ${systemFeeLabel()}</span><strong class="money">฿${formatMoney(fee)}</strong></div><div class="cost-line total"><span>รวม / หาร 4 คน</span><strong class="money">฿${formatMoney((balls * selectedShuttle.price + fee) / 4)} ต่อคน</strong></div>`;
  }
  if (event.target.id === "shopProduct" || event.target.id === "shopQuantity") {
    const item = product(Number(app.querySelector("#shopProduct")?.value));
    const quantity = Number(app.querySelector("#shopQuantity")?.value || 1);
    const preview = app.querySelector("#shopCostPreview");
    if (item && preview) preview.innerHTML = `<div class="cost-line"><span>${item.name} × ${quantity}</span><strong class="money">฿${formatMoney(item.price * quantity)}</strong></div><div class="cost-line total"><span>บวกเข้ายอดของผู้ซื้อ</span><strong>ชำระพร้อมค่าลูก</strong></div>`;
  }
});

document.querySelector("#fullscreenButton").addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});

let syncCountdown = 15;
setInterval(() => {
  renderClock();
  syncCountdown -= 1;
  if (syncCountdown <= 0) {
    state.lastSync = new Date();
    syncCountdown = 15;
    if (state.view === "board" && !realtime.connected) {
      if (state.boardAutoCycle) state.boardQueueCount = state.boardQueueCount === 10 ? 20 : 10;
      render();
    }
  }
  const count = document.querySelector("#syncCount");
  if (count) count.textContent = syncCountdown;
}, 1000);

const dashboardCheck = getDashboardMetrics();
console.assert(Math.abs(dashboardCheck.today - dashboardCheck.ballRevenue - dashboardCheck.entryRevenue - dashboardCheck.shopRevenue) < 0.001, "Dashboard revenue breakdown must equal today's total");
console.assert(dashboardCheck.year >= dashboardCheck.month && dashboardCheck.month >= dashboardCheck.today, "Dashboard period totals must be cumulative");

render();
connectRealtime();
