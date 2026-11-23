import {createDetector} from './inference.mjs';
import {models,version} from './weights.mjs';
export const detect=createDetector(models,version);
