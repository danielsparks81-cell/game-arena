import QRCode from 'qrcode';

const url = process.argv[2] || 'https://game-arena-ten-gamma.vercel.app';
const out = process.argv[3] || 'C:/Users/Dan/Desktop/game-arena-qr.png';

await QRCode.toFile(out, url, {
  width: 600,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#000000', light: '#ffffff' },
});
console.log(`Saved QR for ${url} -> ${out}`);
