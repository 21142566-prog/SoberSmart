const adcValueEl = document.getElementById('adc-value');
const statusValueEl = document.getElementById('status-value');
const statusTitle = document.getElementById('status-title');
const bacDisplay = document.querySelector('.title-group h1');
const connectButton = document.getElementById('connect-button');
const toast = document.getElementById('toast');
const liveTimeEl = document.getElementById('live-time');
const liveDateEl = document.getElementById('live-date');

let lineBuffer = '';
let usbDevice = null; // Biến lưu trữ thiết bị kết nối qua WebUSB

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

// Định dạng màu sắc giao diện tương ứng với trạng thái mạch gửi lên
function getStatusInfo(status) {
  switch (status) {
    case 'IDLE': return { label: 'SẴN SÀNG ĐO', color: '#38bdf8' };     // Xanh dương bầu trời
    case 'MEASURING': return { label: 'ĐANG THỔI KHÍ...', color: '#a855f7' }; // Tím nhấp nháy
    case 'WAIT_RESET': return { label: 'CHỜ RESET MẠCH', color: '#fbbf24' }; // Vàng cảnh báo
    case 'LEVEL1': return { label: 'VI PHẠM MỨC 1', color: '#f97316' };  // Cam phạt nhẹ
    case 'LEVEL2': return { label: 'VI PHẠM NẶNG', color: '#ef4444' };   // Đỏ hú còi
    default: return { label: 'AN TOÀN (SAFE)', color: '#34d399' };     // Xanh lá
  }
}

// --- 2. XỬ LÝ CHUỖI JSON NHẬN ĐƯỢC ---
function processLine(line) {
  line = line.trim();
  if (!line) return;

  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return;

  try {
    const data = JSON.parse(line.substring(start, end + 1));

    // Trạng thái chờ rảnh (IDLE) -> Đưa màn hình về 0
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

    // Trạng thái chốt kết quả chờ nhấn nút cứng (WAIT_RESET)
    if (data.status === 'WAIT_RESET') {
      const waitInfo = getStatusInfo('WAIT_RESET');
      statusTitle.textContent = waitInfo.label;
      statusTitle.style.color = waitInfo.color;
      setToast('Đã chốt đỉnh cồn! Hãy nhấn nút cứng trên thiết bị để đo lượt mới.');
      return; 
    }

    // Cập nhật giá trị khí thở mg/L tức thời
    const mgL = data.mgL ?? 0;
    adcValueEl.textContent = Number(mgL).toFixed(4);

    // Cập nhật nhãn trạng thái (SAFE / LEVEL1 / LEVEL2 / MEASURING)
    const info = getStatusInfo(data.status ?? 'SAFE');
    statusTitle.textContent = info.label;
    statusTitle.style.color = info.color;
    statusValueEl.textContent = data.status;
    statusValueEl.style.color = info.color;

    // Cập nhật phần trăm nồng độ cồn máu (% BAC)
    const pct = (data.pct ?? 0).toFixed(3);
    bacDisplay.textContent = pct + '%';

    setToast(`Khí thở: ${Number(mgL).toFixed(4)} mg/L | Điện áp: ${(data.mv ?? 0).toFixed(1)} mV`);
  } catch (e) {
    console.warn('Lỗi phân tích cú pháp JSON:', line);
  }
}

// Bộ đệm xử lý tách dòng dữ liệu thô liên tục
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

// --- 3. KẾT NỐI QUA WEBUSB (HỖ TRỢ CẢ PC VÀ ĐIỆN THOẠI) ---
connectButton.addEventListener('click', async () => {
  if (!('usb' in navigator)) {
    setToast('Trình duyệt không hỗ trợ WebUSB API. Hãy dùng Chrome trên PC/Android!');
    return;
  }

  try {
    connectButton.disabled = true;
    connectButton.textContent = 'Đang kết nối...';

    // Quét thiết bị dựa trên VID/PID của STM32 Custom HID
    usbDevice = await navigator.usb.requestDevice({
      filters: [{ vendorId: 0x0483, productId: 0x5750 }]
    });

    await usbDevice.open();
    await usbDevice.selectConfiguration(1);

    // KIỂM TRA VÀ CHIẾM QUYỀN INTERFACE CHUẨN ĐỐI VỚI DÒNG G0B1
    // Thử Interface 1 trước (Interface truyền dữ liệu thô của Custom HID)
    try {
      await usbDevice.claimInterface(0); 
      console.log("Đã chiếm quyền thành công Interface 0");
    } catch (ifaceErr) {
      console.error("Không thể chiếm quyền Interface 0:", ifaceErr);
      throw ifaceErr;
    }

    connectButton.textContent = 'Đã kết nối';
    setToast('Kết nối thành công tới STM32G0B1 Custom HID!');

    const decoder = new TextDecoder();
    
    // VÒNG LẶP ĐỌC DỮ LIỆU AN TOÀN (CÓ THỂ TỰ THOÁT NẾU LỖI PHẦN CỨNG)
    while (usbDevice && usbDevice.opened) {
      try {
        // ĐÚNG CHUẨN: Đọc từ Endpoint 0x81 (Endpoint 1 IN của Custom HID)
        let result = await usbDevice.transferIn(0x81, 64); 
        
        if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
          let text = decoder.decode(result.data);
          
          // Loại bỏ toàn bộ ký tự NULL (\0) dư thừa ở đuôi gói tin 64 byte
          text = text.replace(/\0/g, ''); 
          
          handleRawData(text);
        } else if (result.status === 'stall') {
          console.warn('Endpoint bị kẹt (Stalled), đang tự động clear...');
          await usbDevice.clearHalt('in', 0x81);
        }
      } catch (readErr) {
        console.error("Lỗi trong quá trình đọc dữ liệu liên tục:", readErr);
        break; // Bẻ gãy vòng lặp vô hạn ngay nếu mạch bị rút hoặc mất kết nối phần cứng
      }
    }

  } catch (err) {
    console.error("Lỗi bắt tay kết nối:", err);
    setToast('Mất kết nối hoặc bạn đã hủy chọn thiết bị. Thử lại nhé!');
    connectButton.disabled = false;
    connectButton.textContent = 'Connect Device';
  }
});