const adcValueEl = document.getElementById('adc-value');
const statusValueEl = document.getElementById('status-value');
const statusTitle = document.getElementById('status-title');
const bacDisplay = document.querySelector('.title-group h1');
const connectButton = document.getElementById('connect-button');
const toast = document.getElementById('toast');

let lineBuffer = '';

function setToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
}

function getStatusColor(status) {
  if (status === 'SAFE')    return '#34d399';
  if (status === 'WARNING') return '#f59e0b';
  return '#ef4444';
}

function mvToBAC(mv) {
  const pct = ((mv - 30) / (150 - 30)) * 0.40;
  return Math.max(0, pct).toFixed(2);
}

function processLine(line) {
  line = line.trim();
  if (!line) return;

  // Tìm JSON hợp lệ trong line (bắt đầu { kết thúc })
  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return;

  const jsonStr = line.substring(start, end + 1);

  try {
    const data = JSON.parse(jsonStr);

    // Cập nhật ADC
    if (data.adc !== undefined)
      adcValueEl.textContent = data.adc;

    // Cập nhật status
    const status = data.status ?? 'SAFE';
    statusValueEl.textContent = status;
    statusValueEl.style.color = getStatusColor(status);
    statusTitle.textContent = status;
    statusTitle.style.color = getStatusColor(status);

    // Cập nhật BAC %
    const bac = mvToBAC(data.mv ?? 0);
    bacDisplay.textContent = bac + '%';

    // Cập nhật toast
    setToast(`ADC: ${data.adc} | ${(data.mv ?? 0).toFixed(1)} mV | ${status}`);

  } catch (e) {
    console.warn('Parse lỗi:', jsonStr);
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