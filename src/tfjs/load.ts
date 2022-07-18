import { log, join } from '../util/util';
import * as tf from '../../dist/tfjs.esm.js';
import type { GraphModel } from './types';
import type { Config } from '../config';
import * as modelsDefs from '../../models/models.json';

const options = {
  cacheModels: true,
  cacheSupported: true,
  verbose: true,
  debug: false,
  modelBasePath: '',
};

export type ModelInfo = {
  name: string,
  inCache: boolean,
  sizeDesired: number,
  sizeFromManifest: number,
  sizeLoadedWeights: number,
}

export const modelStats: Record<string, ModelInfo> = {};

async function httpHandler(url, init?): Promise<Response | null> {
  if (options.debug) log('load model fetch:', url, init);
  return fetch(url, init);
}

export function setModelLoadOptions(config: Config) {
  options.cacheModels = config.cacheModels;
  options.verbose = config.debug;
  options.modelBasePath = config.modelBasePath;
}

export async function loadModel(modelPath: string | undefined): Promise<GraphModel> {
  let modelUrl = join(options.modelBasePath, modelPath || '');
  if (!modelUrl.toLowerCase().endsWith('.json')) modelUrl += '.json';
  const modelPathSegments = modelUrl.includes('/') ? modelUrl.split('/') : modelUrl.split('\\');
  const shortModelName = modelPathSegments[modelPathSegments.length - 1].replace('.json', '');
  const cachedModelName = 'indexeddb://' + shortModelName; // generate short model name for cache
  modelStats[shortModelName] = {
    name: shortModelName,
    sizeFromManifest: 0,
    sizeLoadedWeights: 0,
    sizeDesired: modelsDefs[shortModelName],
    inCache: false,
  };
  options.cacheSupported = (typeof window !== 'undefined') && (typeof window.localStorage !== 'undefined') && (typeof window.indexedDB !== 'undefined'); // check if running in browser and if indexedb is available
  let cachedModels = {};
  try {
    cachedModels = (options.cacheSupported && options.cacheModels) ? await tf.io.listModels() : {}; // list all models already in cache // this fails for webview although localStorage is defined
  } catch {
    options.cacheSupported = false;
  }
  modelStats[shortModelName].inCache = (options.cacheSupported && options.cacheModels) && Object.keys(cachedModels).includes(cachedModelName); // is model found in cache
  const tfLoadOptions = typeof fetch === 'undefined' ? {} : { fetchFunc: (url, init?) => httpHandler(url, init) };
  const model: GraphModel = new tf.GraphModel(modelStats[shortModelName].inCache ? cachedModelName : modelUrl, tfLoadOptions) as unknown as GraphModel; // create model prototype and decide if load from cache or from original modelurl
  let loaded = false;
  try {
    // @ts-ignore private function
    model.findIOHandler(); // decide how to actually load a model
    if (options.debug) log('model load handler:', model['handler']);
    // @ts-ignore private property
    const artifacts = await model.handler.load(); // load manifest
    modelStats[shortModelName].sizeFromManifest = artifacts?.weightData?.byteLength || 0;
    model.loadSync(artifacts); // load weights
    // @ts-ignore private property
    modelStats[shortModelName].sizeLoadedWeights = model?.artifacts?.weightData?.byteLength || 0;
    if (options.verbose) log('load model:', model['modelUrl'], { bytes: modelStats[shortModelName].sizeLoadedWeights }, options);
    loaded = true;
  } catch (err) {
    log('error loading model:', modelUrl, err);
  }
  if (loaded && options.cacheModels && options.cacheSupported && !modelStats[shortModelName].inCache) { // save model to cache
    try {
      const saveResult = await model.save(cachedModelName);
      log('model saved:', cachedModelName, saveResult);
    } catch (err) {
      log('error saving model:', modelUrl, err);
    }
  }
  return model;
}
