const adcValueEl = document.getElementById('adc-value');
const statusValueEl = document.getElementById('status-value');
const statusTitle = document.getElementById('status-title');
const bacDisplay = document.querySelector('.title-group h1');
const connectButton = document.getElementById('connect-button');
const toast = document.getElementById('toast');
const liveTimeEl = document.getElementById('live-time');
const liveDateEl = document.getElementById('live-date');

let lineBuffer = '';
let usbDevice = null; // Biến lưu trữ thiết bị nếu kết nối qua WebUSB (Điện thoại)
let serialPort = null; // Biến lưu trữ cổng nếu kết nối qua WebSerial (Laptop)

// --- 1. CẬP NHẬT ĐỒNG HỒ REALTIME ---
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
  switch (status) {
    case 'IDLE': return { label: 'SẴN SÀNG', color: '#38bdf8' };
    case 'MEASURING': return { label: 'ĐANG THỔI KHÍ...', color: '#a855f7' };
    case 'WAIT_RESET': return { label: 'ĐO XONG - CHỜ RESET', color: '#fbbf24' };
    case 'LEVEL1': return { label: 'VI PHẠM MỨC 1', color: '#f97316' };
    case 'LEVEL2': return { label: 'VI PHẠM NẶNG', color: '#ef4444' };
    default: return { label: 'AN TOÀN (SAFE)', color: '#34d399' };
  }
}

// --- 2. XỬ LÝ CHUỖI JSON ĐỒ VỀ ---
function processLine(line) {
  line = line.trim();
  if (!line) return;

  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return;

  try {
    const data = JSON.parse(line.substring(start, end + 1));

    if (data.status === 'IDLE') {
      bacDisplay.textContent = '0.00%';
      adcValueEl.textContent = '0.0000';
      const idleInfo = getStatusInfo('IDLE');
      statusTitle.textContent = idleInfo.label;
      statusTitle.style.color = idleInfo.color;
      statusValueEl.textContent = 'SAFE';
      statusValueEl.style.color = '#34d399';
      setToast(`Hệ thống rảnh. Điện áp nền: ${(data.mv ?? 0).toFixed(1)} mV`);
      return;
    }

    if (data.status === 'WAIT_RESET') {
      const waitInfo = getStatusInfo('WAIT_RESET');
      statusTitle.textContent = waitInfo.label;
      statusTitle.style.color = waitInfo.color;
      setToast('Đã chốt kết quả! Hãy nhấn nút trên mạch để đo lượt mới.');
      return;
    }

    const mgL = data.mgL ?? 0;
    adcValueEl.textContent = Number(mgL).toFixed(4);

    const info = getStatusInfo(data.status ?? 'SAFE');
    statusTitle.textContent = info.label;
    statusTitle.style.color = info.color;
    statusValueEl.textContent = data.status;
    statusValueEl.style.color = info.color;

    const pct = (data.pct ?? 0).toFixed(3);
    bacDisplay.textContent = pct + '%';

    setToast(`Khí thở: ${Number(mgL).toFixed(4)} mg/L | Điện áp: ${(data.mv ?? 0).toFixed(1)} mV`);
  } catch (e) {
    console.warn('Lỗi parse JSON:', line);
  }
}

// Hàm gom và tách dòng dữ liệu thu được từ cả 2 nguồn (USB / Serial)
function handleRawData(textChunk) {
  lineBuffer += textChunk;
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

// --- 3. LOGIC KẾT NỐI ĐA NỀN TẢNG ---
connectButton.addEventListener('click', async () => {
  // BƯỚC THỬ 1: Nếu chạy trên Laptop (Có hỗ trợ Web Serial API)
  if ('serial' in navigator) {
    try {
      connectButton.disabled = true;
      connectButton.textContent = 'Đang kết nối (PC)...';

      serialPort = await navigator.serial.requestPort();
      await serialPort.open({ baudRate: 115200 });

      const decoder = new TextDecoderStream();
      serialPort.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();

      connectButton.textContent = 'Đã kết nối';
      setToast('Kết nối thành công qua Web Serial (Laptop)!');

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) handleRawData(value);
      }
    } catch (err) {
      console.error(err);
      setToast('Lỗi kết nối Serial trên Laptop. Thử lại nhé!');
      connectButton.disabled = false;
      connectButton.textContent = 'Connect Device';
    }
    return;
  }

  // BƯỚC THỬ 2: Nếu chạy trên Điện thoại (Không có Serial, chuyển sang WebUSB API)
  if ('usb' in navigator) {
    try {
      connectButton.disabled = true;
      connectButton.textContent = 'Đang kết nối (Phone)...';

      // Lọc theo đúng mã nhận diện mặc định của STM32 Virtual COM Port (VID: 0x0483, PID: 0x5740)
      usbDevice = await navigator.usb.requestDevice({
        filters: [{ vendorId: 0x0483, productId: 0x5740 }]
      });

      await usbDevice.open();
      await usbDevice.selectConfiguration(1);
      
      // Lớp CDC của STM32 có 2 Interface: 0 (Control) và 1 (Data). Ta cần chiếm quyền Interface 1 để đọc dữ liệu
      await usbDevice.claimInterface(1); 
      
      // Gửi lệnh cấu hình để kích hoạt đường truyền (DTR - Data Terminal Ready) của CDC Driver
      await usbDevice.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x22, // SET_CONTROL_LINE_STATE
        value: 0x01,  // DTR = 1
        index: 0x01   // Interface số 1
      });

      connectButton.textContent = 'Đã kết nối';
      setToast('Kết nối thành công qua WebUSB (Điện thoại)!');

      const decoder = new TextDecoder();
      
      // Vòng lặp liên tục đọc dữ liệu thô từ Endpoint số 1 của STM32 (Mặc định cho kênh IN của CDC)
      while (true) {
        // Đọc tối đa gói dữ liệu 64 byte từ Endpoint 1, timeout mặc định
        let result = await usbDevice.transferIn(1, 64); 
        if (result.status === 'ok' && result.data.byteLength > 0) {
          let text = decoder.decode(result.data);
          handleRawData(text);
        }
      }
    } catch (err) {
      console.error(err);
      setToast('Không thể kết nối thiết bị USB. Đảm bảo bạn đã cấp quyền!');
      connectButton.disabled = false;
      connectButton.textContent = 'Connect Device';
    }
    return;
  }

  // Trường hợp trình duyệt quá cũ không hỗ trợ cả hai
  setToast('Trình duyệt này quá cũ hoặc bị khóa tính năng kết nối phần cứng!');
});