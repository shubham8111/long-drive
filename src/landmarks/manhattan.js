// Manhattan's landmarks (see common.js for the contract)
import { TIMES_SQUARE } from './times-square.js';
import { WASHINGTON_SQUARE } from './washington-square.js';
import { MIDTOWN } from './midtown.js';
export const MANHATTAN_LANDMARKS = [TIMES_SQUARE, WASHINGTON_SQUARE, MIDTOWN].flat().filter(Boolean);
