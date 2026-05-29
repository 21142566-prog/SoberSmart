const adcValue = document.getElementById('adc-value');
const statusValue = document.getElementById('status-value');
const statusTitle = document.getElementById('status-title');
const connectButton = document.getElementById('connect-button');
const toast = document.getElementById('toast');

function updateStatus({ adc, status, message }) {
  if (adc !== undefined) {
    adcValue.textContent = adc;
  }

  if (status) {
    statusValue.textContent = status;
    statusTitle.textContent = status === 'SAFE' ? 'SAFE' : 'UNSAFE';
    statusValue.style.color = status === 'SAFE' ? '#34d399' : '#f97316';
  }

  if (message) {
    toast.textContent = message;
    toast.classList.remove('hidden');
  }
}

function setToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
}

connectButton.addEventListener('click', async () => {
  if (!('serial' in navigator)) {
    setToast('Web Serial API không được hỗ trợ trên trình duyệt này.');
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

    setToast('Đã kết nối với thiết bị STM32. Đang chờ dữ liệu...');

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      const trimmed = value.trim();
      if (!trimmed) continue;

      console.log('Serial:', trimmed);

      const parsed = Number(trimmed);
      if (!Number.isNaN(parsed)) {
        updateStatus({ adc: parsed, status: parsed > 50 ? 'UNSAFE' : 'SAFE' });
      } else {
        updateStatus({ message: `Dữ liệu nhận: ${trimmed}` });
      }
    }
  } catch (err) {
    console.error(err);
    setToast('Không thể kết nối STM32. Hãy thử lại.');
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = 'Connect Device';
  }
});
