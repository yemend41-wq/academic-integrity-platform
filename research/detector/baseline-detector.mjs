import {createDetector} from './inference.mjs';
import {models,version} from './baseline-weights.mjs';
export const detect=createDetector(models,version);
