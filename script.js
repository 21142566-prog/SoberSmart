const adcValueEl = document.getElementById('adc-value');
const statusValueEl = document.getElementById('status-value');
const statusTitle = document.getElementById('status-title');
const bacDisplay = document.querySelector('.title-group h1');
const connectButton = document.getElementById('connect-button');
const toast = document.getElementById('toast');
const liveTimeEl = document.getElementById('live-time');
const liveDateEl = document.getElementById('live-date');

let lineBuffer = '';

function updateClock() {
  if (!liveTimeEl || !liveDateEl) return;

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const weekdays = ['CN', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7'];

  liveTimeEl.textContent = `${hours}h:${minutes}p:${seconds}s`;
  liveDateEl.textContent = `${day}/${month}/${year} · ${weekdays[now.getDay()]}`;
}

updateClock();
setInterval(updateClock, 1000);

function setToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
}

function getStatusInfo(status) {
  if (status === 'IDLE') {
    return { label: 'IDLE', color: '#94a3b8' };
  }
  if (status === 'WAIT_RESET') {
    return { label: 'NHẤN NÚT ĐỂ TIẾP TỤC', color: '#fbbf24' };
  }
  if (status === 'LEVEL1') {
    return { label: 'LEVEL1', color: '#f59e0b' };
  }
  if (status === 'LEVEL2') {
    return { label: 'LEVEL2', color: '#ef4444' };
  }
  return { label: 'SAFE', color: '#34d399' };
}

function mvToBAC(mv) {
  const pct = ((mv - 30) / (150 - 30)) * 0.40;
  return Math.max(0, pct).toFixed(2);
}

function processLine(line) {
  line = line.trim();
  if (!line) return;

  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return;

  try {
    const data = JSON.parse(line.substring(start, end + 1));

    // Reset web khi ở trạng thái chờ / reset
    if (data.status === 'IDLE' || data.status === 'WAIT_RESET') {
      bacDisplay.textContent = '0.00%';
      adcValueEl.textContent = '--';

      const idleInfo = getStatusInfo(data.status);
      statusTitle.textContent = idleInfo.label;
      statusTitle.style.color = idleInfo.color;
      statusValueEl.textContent = idleInfo.label;
      statusValueEl.style.color = idleInfo.color;

      setToast(data.status === 'WAIT_RESET'
        ? 'Đã kết thúc đo. Nhấn nút để đo tiếp theo...'
        : 'Sẵn sàng đo. Nhấn nút để bắt đầu đo 5 giây...');
      return;
    }

    // Cập nhật giá trị mg/L
    const mgL = data.mgL ?? data.adc ?? 0;
    if (data.adc !== undefined || data.mgL !== undefined) {
      adcValueEl.textContent = Number(mgL).toFixed(4);
    }

    // Cập nhật status
    const info = getStatusInfo(data.status ?? 'SAFE');
    statusValueEl.textContent = info.label;
    statusValueEl.style.color = info.color;
    statusTitle.textContent = info.label;
    statusTitle.style.color = info.color;

    // Cập nhật BAC %
    const pct = (data.pct ?? 0).toFixed(3);
    bacDisplay.textContent = pct + '%';

    // Cập nhật toast
    setToast(
      `mg/L: ${Number(mgL).toFixed(4)} | ${(data.mv ?? 0).toFixed(1)} mV | ${info.label}`
    );

  } catch (e) {
    console.warn('Parse lỗi:', line);
  }
}

connectButton.addEventListener('click', async () => {
  if (!('serial' in navigator)) {
    setToast('Web Serial API không hỗ trợ. Dùng Chrome hoặc Edge nhé!');
    return;
  }

  try {
    connectButton.disabled = true;
    connectButton.textContent = 'Đang kết nối...';

    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });

    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    const reader = decoder.readable.getReader();

    connectButton.textContent = 'Đã kết nối';
    setToast('Đã kết nối! Đang nhận dữ liệu...');

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      // Ghép buffer
      lineBuffer += value;

      // Tách theo \n
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop(); // giữ phần chưa đủ dòng

      for (const line of lines) {
        processLine(line);
      }

      // Xử lý thêm trường hợp JSON đủ trong buffer chưa có \n
      if (lineBuffer.includes('{') && lineBuffer.includes('}')) {
        processLine(lineBuffer);
        lineBuffer = '';
      }
    }

  } catch (err) {
    console.error(err);
    setToast('Mất kết nối. Thử lại nhé!');
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = 'Connect Device';
  }
});