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

// 1. CẬP NHẬT ĐẦY ĐỦ 5 TRẠNG THÁI ĐỒNG BỘ VỚI STM32
function getStatusInfo(status) {
  switch (status) {
    case 'IDLE':
      return { label: 'SẴN SÀNG ĐO', color: '#3b82f6' }; // Màu xanh dương dứt khoát
    case 'MEASURING':
      return { label: 'ĐANG THỔI...', color: '#a855f7' }; // Màu tím nhấp nháy chuyển động
    case 'WAIT_RESET':
      return { label: 'CHỜ RESET CHU TRÌNH', color: '#64748b' }; // Màu xám chờ lệnh
    case 'LEVEL1':
      return { label: 'CẢNH BÁO: LEVEL 1', color: '#f59e0b' }; // Cam
    case 'LEVEL2':
      return { label: 'NGUY HIỂM: LEVEL 2', color: '#ef4444' }; // Đỏ hú còi
    case 'SAFE':
    default:
      return { label: 'AN TOÀN (SAFE)', color: '#10b981' }; // Xanh lá
  }
}

function processLine(line) {
  line = line.trim();
  if (!line) return;

  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return;

  try {
    const data = JSON.parse(line.substring(start, end + 1));

    // 2. KHÔNG CÒN ÉP XOÁ MÀN HÌNH Ở TRẠNG THÁI 'WAIT_RESET' NỮA (ĐỂ GIỮ LẠI ĐỈNH KẾT QUẢ ĐO)
    if (data.status === 'IDLE') {
      bacDisplay.textContent = '0.000%';
      adcValueEl.textContent = '--';

      const idleInfo = getStatusInfo(data.status);
      statusTitle.textContent = idleInfo.label;
      statusTitle.style.color = idleInfo.color;
      statusValueEl.textContent = idleInfo.label;
      statusValueEl.style.color = idleInfo.color;

      setToast('Sẵn sàng đo. Hãy ngậm ống thổi và NHẤN NÚT trên mạch để bắt đầu...');
      return;
    }

    // Nếu mạch báo trạng thái Chờ nhấn nút để đặt lại chu trình mới
    if (data.status === 'WAIT_RESET') {
      const waitInfo = getStatusInfo(data.status);
      statusTitle.textContent = waitInfo.label;
      statusTitle.style.color = waitInfo.color;
      statusValueEl.textContent = waitInfo.label;
      statusValueEl.style.color = waitInfo.color;
      
      setToast('Chu kỳ đo kết thúc. Vui lòng NHẤN NÚT CỨNG một lần nữa để làm sạch cảm biến...');
      return;
    }

    // 3. CẬP NHẬT GIÁ TRỊ LỌC ADC THỰC TẾ (TỪ FIRMWARE)
    if (data.adc !== undefined) {
      adcValueEl.textContent = data.adc;
    }

    // Cập nhật trạng thái hiển thị thông tin màu sắc (MEASURING, SAFE, LEVEL1, LEVEL2)
    const info = getStatusInfo(data.status ?? 'SAFE');
    statusValueEl.textContent = info.label;
    statusValueEl.style.color = info.color;
    statusTitle.textContent = info.label;
    statusTitle.style.color = info.color;

    // 4. CẬP NHẬT NỒNG ĐỘ CỒN CHUẨN % BAC (BA CHỮ SỐ THẬP PHÂN)
    if (data.pct !== undefined) {
      const pct = data.pct.toFixed(3);
      bacDisplay.textContent = pct + '%';
    }

    // Cập nhật thanh Toast hiển thị chi tiết thông số thời gian thực dưới chân trang
    const mgLVal = data.mgL !== undefined ? data.mgL.toFixed(4) : '0.0000';
    const mvVal = data.mv !== undefined ? data.mv.toFixed(1) : '0.0';
    setToast(
      `Độ cồn: ${mgLVal} mg/L | Điện áp: ${mvVal} mV | Trạng thái: ${info.label}`
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
    // Khớp tốc độ Baudrate 115200 cấu hình trong chip STM32 UART
    await port.open({ baudRate: 115200 });

    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    const reader = decoder.readable.getReader();

    connectButton.textContent = 'Đã kết nối';
    setToast('Kết nối cổng COM thành công! Đang nhận chuỗi dữ liệu JSON...');

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      lineBuffer += value;

      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop(); 

      for (const line of lines) {
        processLine(line);
      }

      if (lineBuffer.includes('{') && lineBuffer.includes('}')) {
        processLine(lineBuffer);
        lineBuffer = '';
      }
    }

  } catch (err) {
    console.error(err);
    setToast('Mất kết nối cổng COM phần cứng. Vui lòng cắm lại cáp Type-C!');
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = 'Connect Device';
  }
});