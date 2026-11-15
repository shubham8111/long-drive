// Bryce Canyon's landmarks (see common.js for the contract)
import { HOODOOS } from './hoodoos.js';
import { RED_CANYON } from './red-canyon.js';
import { BRYCE_ROADSIDE } from './bryce-roadside.js';
export const BRYCE_LANDMARKS = [HOODOOS, RED_CANYON, BRYCE_ROADSIDE].flat().filter(Boolean);
