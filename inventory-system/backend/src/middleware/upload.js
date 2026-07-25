const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { uuid } = require('../utils/helpers');

const uploadPath = path.resolve(config.uploadDir);
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let sub = 'misc';
    if (file.fieldname === 'logo') sub = 'logos';
    else if (file.fieldname === 'avatar') sub = 'avatars';
    else if (file.fieldname === 'image' || file.fieldname === 'product_image') sub = 'products';
    else if (file.fieldname === 'file' || file.fieldname === 'import') sub = 'imports';
    const dir = path.join(uploadPath, sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuid()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const allowed = /\.(jpg|jpeg|png|gif|webp|svg|pdf|csv|xlsx|xls)$/i;
  if (allowed.test(path.extname(file.originalname))) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = upload;
