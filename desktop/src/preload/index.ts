import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('lisna', { ping: () => 'pong' });
