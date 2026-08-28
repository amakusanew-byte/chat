// Generate secret webhook Telegram yang acak.
const crypto = require("crypto");
console.log("tg_" + crypto.randomBytes(18).toString("hex"));
