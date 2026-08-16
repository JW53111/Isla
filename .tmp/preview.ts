import sharp from 'sharp';

const src = process.argv[2];
const dst = process.argv[3];
await sharp(src).resize({ width: 1024 }).png().toFile(dst);
console.log('saved ' + dst);
