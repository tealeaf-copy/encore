// Usage: node server/hash-password.js 'their password'
// Prints the value for the 4th field of a person in ENCORE_USERS: Name|email|roles|scrypt$...
import { hashPassword } from "./auth.js";
const pw = process.argv[2];
if (!pw) { console.error("Usage: node server/hash-password.js 'password'"); process.exit(1); }
console.log(hashPassword(pw));
