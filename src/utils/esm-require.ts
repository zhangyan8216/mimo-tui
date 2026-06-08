// CommonJS require() for ESM modules
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export default require;
