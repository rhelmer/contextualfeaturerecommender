/*! This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

const unload = require("sdk/system/unload").when;
const {setInterval} = require("sdk/timers");
const {EventTarget} = require("sdk/event/target");
const {emit} = require('sdk/event/core');
const sp = require("sdk/simple-prefs");
const {pathFor} = require('sdk/system');
const prefs = sp.prefs;
const file = require('sdk/io/file');
const {Cu} = require("chrome");
const {TextEncoder, TextDecoder} = require('sdk/io/buffer');
Cu.import("resource://gre/modules/osfile.jsm");

const DIR_PATH = file.join(pathFor("ProfD"), require('sdk/self').id + "-storage");

const osFileObjects = {}

//TODO: add function definition capabilities using closures, to make it a real persistent object,
// and not only a JsonStore
// TODO: work on this and make it an npm package
// read sdk/simple-storage.js again for this + the way it's done in rails
// TODO: make direct manipulation with an arbitrary depth possible (e.g. sample-storage.sample-p1.sample-p2 = sample-v)

module.exports = EventTarget();
exports = module.exports;

exports.osFileObjects = osFileObjects; // only 1 object instance for each file should exist

exports.PersistentObject = function(type, options){

  // if only a string is passed, assume that it's the address
  if (typeof options === "string")
    options = {address: options}

  switch(type){
    case "simplePref":
      return require('sdk/core/promise').resolve(SimplePrefStorage(options));
      break;
    case "osFile":
      return OsFileStorage(options);
      break;
    default:
  }

};

function OsFileStorage(options){

  // only 1 object instance for each file should exist
  if (osFileObjects[options.address])
    return require('sdk/core/promise').resolve(osFileObjects[options.address]);

  console.log("creating " + options.address);
  
  let data = {};

  let encoder = new TextEncoder();  
  let decoder = new TextDecoder();

  let targetObj;

  if (!options.target)
    targetObj = {};
  else
    targetObj = options.target;

  const fileName = options.address + ".json"
  const filePath = file.join(DIR_PATH, fileName);

  console.log(fileName)
  console.log(filePath);
 
  function write(str, opts){
    let safe = opts && opts.safe;
    let arr = encoder.encode(str);

    if (!str)
      logError("empty-str", e, {address: options.address});

    if (!arr)
      logError("empty-arr", e, {address: options.address});


    return OS.File.writeAtomic(filePath, arr, {tmpPath: filePath + ".tmp", backupTo: filePath + ".backup", flush: safe});
  }

  function read(){
    return OS.File.read(filePath).then((arr)=>{
      return decoder.decode(arr);
    });
  }

  function readBackup(){
    return OS.File.read(filePath + ".backup").then((arr)=>{
      return decoder.decode(arr);
    });

    require('./stats').event("read-backup");
  }

  let cachedObj = {};

  return OS.File.makeDir(DIR_PATH).then(()=>{
    return OS.File.exists(filePath);
  }).then(exists =>{
    if (!exists)
      return write(JSON.stringify({}));
  })
  .then(read)
  .then(str => {
    if (str) return str;

    console.log("WARNING: empty os file");
    require('./logger').logWarning({type: "empty-file", info: {address: options.address}});

    return readBackup();
  })
  .then(str =>{
    Object.assign(cachedObj, {data: JSON.parse(str), synced: true})
  })
  .then(()=>{
    let updateFile = function(prop, opts){
      let safe = opts && options.shutdown; 
      let dataStr;

      try {
        dataStr = JSON.stringify(cachedObj.data);
      }
      catch(e) {
        logError("JSON-stringify", e, {address: options.address});
      }

      return write(dataStr, {safe: safe}).then(()=>{
        cachedObj.synced = true;
        console.log("pref update", options.address, prop);
      })
      .catch((e)=> {
        logError("osfilewrite", e, {address: options.address});
      });
    };

    let rObj = StorageObject(updateFile, cachedObj, options);

    osFileObjects[options.address] = rObj;

    return rObj;
  }).catch((e)=> {
    logError("osfilestorage", e, {address: options.address});
  });
}


function SimplePrefStorage(options){
  //create if pref does not exist
  if (!prefs[options.address])
    prefs[options.address] = JSON.stringify({}); 

  // data property lets the cachedObj be easily reset
  let cachedObj = {data: JSON.parse(prefs[options.address]), synced: true};

  let updatePref = function(prop){
    console.log("pref update", options.address, prop);
    cachedObj.synced = true;
    prefs[options.address] = JSON.stringify(cachedObj.data);
  };

  let rObj = StorageObject(updatePref, cachedObj, options);

  // to handle external pref changes
  let f = function(p){
    rObj._syncCache({force:true});
  }
  sp.on(options.address, f);
 
  unload(function(){sp.removeListener(options.address, f)});

  return rObj;
}


function StorageObject(updateFn, cachedObj, options){
  let targetObj;
  if (!options.target)
    targetObj = {};
  else
    targetObj = options.target;

  let evtTarget = EventTarget();

  let wrapper = {
      _copyCache: function(){
        return Object.assign({}, cachedObj.data);
      },
      _pasteCache: function(obj){
        cachedObj.data = Object.assign({}, obj);
        cachedObj.synced = false;
        emit(evtTarget, 'update', {type: 'pasteCache', address: options.address});
        emit(exports, options.address, {type: 'pasteCache', address: options.address});
      },
      _openCache: function(callback){
        let obj = cachedObj.data;
        callback(obj);
        cachedObj.synced = false;
        emit(evtTarget, 'update', {type: 'openCache', address: options.address});
        emit(exports, options.address, {type: 'openCache', address: options.address});
      },
      _syncCache: function(opts){
        let force = opts && opts.force;
        if (!cachedObj.synced || force){
          updateFn(undefined, opts).catch((e)=>{logError("osfile sync", e, {address: options.address})});
          emit(evtTarget, 'sync');
        }
      },
      on: function(type, listener){
        evtTarget.on(type, listener);
      },
      off: function(type, listener){
        evtTarget.off(type, listener);
      },
      once: function(type, listener){
        evtTarget.once(type, listener);
      }
    }

    let rObj = new Proxy(targetObj, {
      get: function(target, name) {

        if (name in target)
          return target[name];
        else
          if (cachedObj.data.hasOwnProperty(name)){
            if (typeof cachedObj.data[name] === "object"){
              if (cachedObj.data[name] && cachedObj.data[name].constructor === Array)
                return cachedObj.data[name].slice();
              else
                return Object.assign({}, cachedObj.data[name])
            }
            else
              return cachedObj.data[name];
          }
          else {
            return wrapper[name];
          }

      },
      set: function(target, name, value) {
        if (target.hasOwnProperty(name)){
          target[name] = value;
        }
        else
        {
          cachedObj.data[name] = value;
          cachedObj.synced = false;

          emit(evtTarget, 'update', {type: 'set', name: name, value: value, address: options.address});
          emit(exports, options.address, {type: 'set', name: name, value: value, address: options.address});
        }

        return true;
      },
      has: function(target, prop){
        if (!(prop in target))
          return prop in cachedObj.data;
        else
          return true;
      },
      ownKeys: function(target){
        return Object.getOwnPropertyNames(target).concat(Object.keys(cachedObj.data));
      },
      //ownKeys does not work properly without getOwnDescriptor
      //here is why: https://bugzilla.mozilla.org/show_bug.cgi?id=1110332
      getOwnPropertyDescriptor: function (target, prop){
        return Object.getOwnPropertyDescriptor(target, prop) || Object.getOwnPropertyDescriptor(cachedObj.data, prop);
      },
      deleteProperty: function(target, prop){
        if (prop in target){
          return delete target[prop];
        }
        else {
          let res = delete cachedObj.data[prop];

          cachedObj.synced = false;

          emit(evtTarget, 'update', {type: 'delete', name: name, address: options.address});
          emit(exports, options.address, {type: 'delete', name: name, address: options.address});

          return res;
        }
      }
    });

    let interval = (options && options.update_interval) || prefs["utils.persistent_object.update_interval"];
    let syncTimer = setInterval(()=>{
      wrapper._syncCache();
    }, interval);

    unload(()=>{wrapper._syncCache();});

    return rObj;
}

const logError = function(type, e, info){
  Cu.reportError(e);
  require('./logger').logError({
                                 type: type,
                                 name: e.name,
                                 message: e.message,
                                 fileName: e.fileName,
                                 lineNumber: e.lineNumber,
                                 stack: e.stack,
                                 info: info
                                });
  throw e;
}