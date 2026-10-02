import { MemoryVectorStore } from './memory-vector-store.js';
import { vectorStoreContract } from './__contract__/vector-store-contract.js';

vectorStoreContract('memory', new MemoryVectorStore());
