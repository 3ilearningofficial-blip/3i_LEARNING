__d(function(g,r,i,a,m,e,d){"use strict";Object.defineProperty(e,'__esModule',{value:!0}),Object.defineProperty(e,"auth",{enumerable:!0,get:function(){return c}}),Object.defineProperty(e,"RecaptchaVerifier",{enumerable:!0,get:function(){return n.RecaptchaVerifier}}),Object.defineProperty(e,"signInWithPhoneNumber",{enumerable:!0,get:function(){return n.signInWithPhoneNumber}});var t=r(d[0]),n=r(d[1]);const u={apiKey:"AIzaSyA7KoeaMEmEH9EujxEJWo7dbUrTExI_DEM",projectId:"i-learning-aa525",authDomain:"i-learning-aa525.firebaseapp.com"},o=0===(0,t.getApps)().length?(0,t.initializeApp)(u):(0,t.getApp)(),c=(0,n.getAuth)(o)},1366,[1367,1375]);
__d(function(g,r,i,a,m,e,d){"use strict";Object.defineProperty(e,'__esModule',{value:!0});var t=r(d[0]);Object.keys(t).forEach(function(n){'default'===n||Object.prototype.hasOwnProperty.call(e,n)||Object.defineProperty(e,n,{enumerable:!0,get:function(){return t[n]}})});
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
(0,t.registerVersion)("firebase","12.10.0",'app')},1367,[1368]);
__d(function(g,r,_i,a,m,_e,d){"use strict";Object.defineProperty(_e,'__esModule',{value:!0}),Object.defineProperty(_e,"FirebaseError",{enumerable:!0,get:function(){return n.FirebaseError}}),Object.defineProperty(_e,"SDK_VERSION",{enumerable:!0,get:function(){return ie}}),Object.defineProperty(_e,"_DEFAULT_ENTRY_NAME",{enumerable:!0,get:function(){return H}}),Object.defineProperty(_e,"_addComponent",{enumerable:!0,get:function(){return V}}),Object.defineProperty(_e,"_addOrOverwriteComponent",{enumerable:!0,get:function(){return W}}),Object.defineProperty(_e,"_apps",{enumerable:!0,get:function(){return L}}),Object.defineProperty(_e,"_clearComponents",{enumerable:!0,get:function(){return Z}}),Object.defineProperty(_e,"_components",{enumerable:!0,get:function(){return J}}),Object.defineProperty(_e,"_getProvider",{enumerable:!0,get:function(){return K}}),Object.defineProperty(_e,"_isFirebaseApp",{enumerable:!0,get:function(){return G}}),Object.defineProperty(_e,"_isFirebaseServerApp",{enumerable:!0,get:function(){return X}}),Object.defineProperty(_e,"_isFirebaseServerAppSettings",{enumerable:!0,get:function(){return Q}}),Object.defineProperty(_e,"_registerComponent",{enumerable:!0,get:function(){return q}}),Object.defineProperty(_e,"_removeServiceInstance",{enumerable:!0,get:function(){return Y}}),Object.defineProperty(_e,"_serverApps",{enumerable:!0,get:function(){return U}}),Object.defineProperty(_e,"deleteApp",{enumerable:!0,get:function(){return fe}}),Object.defineProperty(_e,"getApp",{enumerable:!0,get:function(){return ce}}),Object.defineProperty(_e,"getApps",{enumerable:!0,get:function(){return pe}}),Object.defineProperty(_e,"initializeApp",{enumerable:!0,get:function(){return oe}}),Object.defineProperty(_e,"initializeServerApp",{enumerable:!0,get:function(){return se}}),Object.defineProperty(_e,"onLog",{enumerable:!0,get:function(){return he}}),Object.defineProperty(_e,"registerVersion",{enumerable:!0,get:function(){return le}}),Object.defineProperty(_e,"setLogLevel",{enumerable:!0,get:function(){return ue}});var e=r(d[0]),t=r(d[1]),n=r(d[2]),i=r(d[3]);
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
class o{constructor(e){this.container=e}getPlatformInfoString(){return this.container.getProviders().map(e=>{if(s(e)){const t=e.getImmediate();return`${t.library}/${t.version}`}return null}).filter(e=>e).join(' ')}}function s(e){const t=e.getComponent();return"VERSION"===t?.type}const c="@firebase/app",p="0.14.9",f=new t.Logger('@firebase/app'),l="@firebase/app-compat",h="@firebase/analytics-compat",u="@firebase/analytics",b="@firebase/app-check-compat",v="@firebase/app-check",C="@firebase/auth",_="@firebase/auth-compat",y="@firebase/database",w="@firebase/data-connect",D="@firebase/database-compat",O="@firebase/functions",E="@firebase/functions-compat",P="@firebase/installations",S="@firebase/installations-compat",j="@firebase/messaging",A="@firebase/messaging-compat",I="@firebase/performance",k="@firebase/performance-compat",F="@firebase/remote-config",$="@firebase/remote-config-compat",N="@firebase/storage",x="@firebase/storage-compat",R="@firebase/firestore",T="@firebase/ai",B="@firebase/firestore-compat",z="firebase",H='[DEFAULT]',M={[c]:'fire-core',[l]:'fire-core-compat',[u]:'fire-analytics',[h]:'fire-analytics-compat',[v]:'fire-app-check',[b]:'fire-app-check-compat',[C]:'fire-auth',[_]:'fire-auth-compat',[y]:'fire-rtdb',[w]:'fire-data-connect',[D]:'fire-rtdb-compat',[O]:'fire-fn',[E]:'fire-fn-compat',[P]:'fire-iid',[S]:'fire-iid-compat',[j]:'fire-fcm',[A]:'fire-fcm-compat',[I]:'fire-perf',[k]:'fire-perf-compat',[F]:'fire-rc',[$]:'fire-rc-compat',[N]:'fire-gcs',[x]:'fire-gcs-compat',[R]:'fire-fst',[B]:'fire-fst-compat',[T]:'fire-vertex','fire-js':'fire-js',[z]:'fire-js-all'},L=new Map,U=new Map,J=new Map;function V(e,t){try{e.container.addComponent(t)}catch(n){f.debug(`Component ${t.name} failed to register with FirebaseApp ${e.name}`,n)}}function W(e,t){e.container.addOrOverwriteComponent(t)}function q(e){const t=e.name;if(J.has(t))return f.debug(`There were multiple attempts to register component ${t}.`),!1;J.set(t,e);for(const t of L.values())V(t,e);for(const t of U.values())V(t,e);return!0}function K(e,t){const n=e.container.getProvider('heartbeat').getImmediate({optional:!0});return n&&n.triggerHeartbeat(),e.container.getProvider(t)}function Y(e,t,n=H){K(e,t).clearInstance(n)}function G(e){return void 0!==e.options}function Q(e){return!G(e)&&('authIdToken'in e||'appCheckToken'in e||'releaseOnDeref'in e||'automaticDataCollectionEnabled'in e)}function X(e){return null!=e&&void 0!==e.settings}function Z(){J.clear()}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const ee={"no-app":"No Firebase App '{$appName}' has been created - call initializeApp() first","bad-app-name":"Illegal App name: '{$appName}'","duplicate-app":"Firebase App named '{$appName}' already exists with different options or config","app-deleted":"Firebase App named '{$appName}' already deleted","server-app-deleted":'Firebase Server App has been deleted',"no-options":'Need to provide options, when not being deployed to hosting via source.',"invalid-app-argument":"firebase.{$appName}() takes either no argument or a Firebase App instance.","invalid-log-argument":'First argument to `onLog` must be null or a function.',"idb-open":'Error thrown when opening IndexedDB. Original error: {$originalErrorMessage}.',"idb-get":'Error thrown when reading from IndexedDB. Original error: {$originalErrorMessage}.',"idb-set":'Error thrown when writing to IndexedDB. Original error: {$originalErrorMessage}.',"idb-delete":'Error thrown when deleting from IndexedDB. Original error: {$originalErrorMessage}.',"finalization-registry-not-supported":'FirebaseServerApp deleteOnDeref field defined but the JS runtime does not support FinalizationRegistry.',"invalid-server-app-environment":'FirebaseServerApp is not for use in browser environments.'},te=new n.ErrorFactory('app','Firebase',ee);
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
class re{constructor(t,n,i){this._isDeleted=!1,this._options=Object.assign({},t),this._config=Object.assign({},n),this._name=n.name,this._automaticDataCollectionEnabled=n.automaticDataCollectionEnabled,this._container=i,this.container.addComponent(new e.Component('app',()=>this,"PUBLIC"))}get automaticDataCollectionEnabled(){return this.checkDestroyed(),this._automaticDataCollectionEnabled}set automaticDataCollectionEnabled(e){this.checkDestroyed(),this._automaticDataCollectionEnabled=e}get name(){return this.checkDestroyed(),this._name}get options(){return this.checkDestroyed(),this._options}get config(){return this.checkDestroyed(),this._config}get container(){return this._container}get isDeleted(){return this._isDeleted}set isDeleted(e){this._isDeleted=e}checkDestroyed(){if(this.isDeleted)throw te.create("app-deleted",{appName:this._name})}}
/**
   * @license
   * Copyright 2023 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function ae(e,t){const i=(0,n.base64Decode)(e.split('.')[1]);if(null===i)return void console.error(`FirebaseServerApp ${t} is invalid: second part could not be parsed.`);if(void 0===JSON.parse(i).exp)return void console.error(`FirebaseServerApp ${t} is invalid: expiration claim could not be parsed`);1e3*JSON.parse(i).exp-(new Date).getTime()<=0&&console.error(`FirebaseServerApp ${t} is invalid: the token has expired.`)}class ne extends re{constructor(e,t,n,i){const o=void 0===t.automaticDataCollectionEnabled||t.automaticDataCollectionEnabled,s={name:n,automaticDataCollectionEnabled:o};if(void 0!==e.apiKey)super(e,s,i);else{super(e.options,s,i)}this._serverConfig=Object.assign({automaticDataCollectionEnabled:o},t),this._serverConfig.authIdToken&&ae(this._serverConfig.authIdToken,'authIdToken'),this._serverConfig.appCheckToken&&ae(this._serverConfig.appCheckToken,'appCheckToken'),this._finalizationRegistry=null,'undefined'!=typeof FinalizationRegistry&&(this._finalizationRegistry=new FinalizationRegistry(()=>{this.automaticCleanup()})),this._refCount=0,this.incRefCount(this._serverConfig.releaseOnDeref),this._serverConfig.releaseOnDeref=void 0,t.releaseOnDeref=void 0,le(c,p,'serverapp')}toJSON(){}get refCount(){return this._refCount}incRefCount(e){this.isDeleted||(this._refCount++,void 0!==e&&null!==this._finalizationRegistry&&this._finalizationRegistry.register(e,this))}decRefCount(){return this.isDeleted?0:--this._refCount}automaticCleanup(){fe(this)}get settings(){return this.checkDestroyed(),this._serverConfig}checkDestroyed(){if(this.isDeleted)throw te.create("server-app-deleted")}}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const ie="12.10.0";function oe(t,i={}){let o=t;if('object'!=typeof i){i={name:i}}const s=Object.assign({name:H,automaticDataCollectionEnabled:!0},i),c=s.name;if('string'!=typeof c||!c)throw te.create("bad-app-name",{appName:String(c)});if(o||(o=(0,n.getDefaultAppConfig)()),!o)throw te.create("no-options");const p=L.get(c);if(p){if((0,n.deepEqual)(o,p.options)&&(0,n.deepEqual)(s,p.config))return p;throw te.create("duplicate-app",{appName:c})}const f=new e.ComponentContainer(c);for(const e of J.values())f.addComponent(e);const l=new re(o,s,f);return L.set(c,l),l}function se(t,i={}){if((0,n.isBrowser)()&&!(0,n.isWebWorker)())throw te.create("invalid-server-app-environment");let o,s=i||{};if(t&&(G(t)?o=t.options:Q(t)?s=t:o=t),void 0===s.automaticDataCollectionEnabled&&(s.automaticDataCollectionEnabled=!0),o||(o=(0,n.getDefaultAppConfig)()),!o)throw te.create("no-options");const c=Object.assign({},s,o);void 0!==c.releaseOnDeref&&delete c.releaseOnDeref;if(void 0!==s.releaseOnDeref&&'undefined'==typeof FinalizationRegistry)throw te.create("finalization-registry-not-supported",{});const p=''+(f=JSON.stringify(c),[...f].reduce((e,t)=>Math.imul(31,e)+t.charCodeAt(0)|0,0));var f;const l=U.get(p);if(l)return l.incRefCount(s.releaseOnDeref),l;const h=new e.ComponentContainer(p);for(const e of J.values())h.addComponent(e);const u=new ne(o,s,p,h);return U.set(p,u),u}function ce(e=H){const t=L.get(e);if(!t&&e===H&&(0,n.getDefaultAppConfig)())return oe();if(!t)throw te.create("no-app",{appName:e});return t}function pe(){return Array.from(L.values())}async function fe(e){let t=!1;const n=e.name;if(L.has(n))t=!0,L.delete(n);else if(U.has(n)){e.decRefCount()<=0&&(U.delete(n),t=!0)}t&&(await Promise.all(e.container.getProviders().map(e=>e.delete())),e.isDeleted=!0)}function le(t,n,i){let o=M[t]??t;i&&(o+=`-${i}`);const s=o.match(/\s|\//),c=n.match(/\s|\//);if(s||c){const e=[`Unable to register library "${o}" with version "${n}":`];return s&&e.push(`library name "${o}" contains illegal characters (whitespace or "/")`),s&&c&&e.push('and'),c&&e.push(`version name "${n}" contains illegal characters (whitespace or "/")`),void f.warn(e.join(' '))}q(new e.Component(`${o}-version`,()=>({library:o,version:n}),"VERSION"))}function he(e,n){if(null!==e&&'function'!=typeof e)throw te.create("invalid-log-argument");(0,t.setUserLogHandler)(e,n)}function ue(e){(0,t.setLogLevel)(e)}
/**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const de='firebase-heartbeat-store';let be=null;function ge(){return be||(be=(0,i.openDB)("firebase-heartbeat-database",1,{upgrade:(e,t)=>{if(0===t)try{e.createObjectStore(de)}catch(e){console.warn(e)}}}).catch(e=>{throw te.create("idb-open",{originalErrorMessage:e.message})})),be}async function me(e){try{const t=(await ge()).transaction(de),n=await t.objectStore(de).get(Ce(e));return await t.done,n}catch(e){if(e instanceof n.FirebaseError)f.warn(e.message);else{const t=te.create("idb-get",{originalErrorMessage:e?.message});f.warn(t.message)}}}async function ve(e,t){try{const n=(await ge()).transaction(de,'readwrite'),i=n.objectStore(de);await i.put(t,Ce(e)),await n.done}catch(e){if(e instanceof n.FirebaseError)f.warn(e.message);else{const t=te.create("idb-set",{originalErrorMessage:e?.message});f.warn(t.message)}}}function Ce(e){return`${e.name}!${e.options.appId}`}
/**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class ye{constructor(e){this.container=e,this._heartbeatsCache=null;const t=this.container.getProvider('app').getImmediate();this._storage=new Oe(t),this._heartbeatsCachePromise=this._storage.read().then(e=>(this._heartbeatsCache=e,e))}async triggerHeartbeat(){try{const e=this.container.getProvider('platform-logger').getImmediate().getPlatformInfoString(),t=we();if(null==this._heartbeatsCache?.heartbeats&&(this._heartbeatsCache=await this._heartbeatsCachePromise,null==this._heartbeatsCache?.heartbeats))return;if(this._heartbeatsCache.lastSentHeartbeatDate===t||this._heartbeatsCache.heartbeats.some(e=>e.date===t))return;if(this._heartbeatsCache.heartbeats.push({date:t,agent:e}),this._heartbeatsCache.heartbeats.length>30){const e=Pe(this._heartbeatsCache.heartbeats);this._heartbeatsCache.heartbeats.splice(e,1)}return this._storage.overwrite(this._heartbeatsCache)}catch(e){f.warn(e)}}async getHeartbeatsHeader(){try{if(null===this._heartbeatsCache&&await this._heartbeatsCachePromise,null==this._heartbeatsCache?.heartbeats||0===this._heartbeatsCache.heartbeats.length)return'';const e=we(),{heartbeatsToSend:t,unsentEntries:i}=De(this._heartbeatsCache.heartbeats),o=(0,n.base64urlEncodeWithoutPadding)(JSON.stringify({version:2,heartbeats:t}));return this._heartbeatsCache.lastSentHeartbeatDate=e,i.length>0?(this._heartbeatsCache.heartbeats=i,await this._storage.overwrite(this._heartbeatsCache)):(this._heartbeatsCache.heartbeats=[],this._storage.overwrite(this._heartbeatsCache)),o}catch(e){return f.warn(e),''}}}function we(){return(new Date).toISOString().substring(0,10)}function De(e,t=1024){const n=[];let i=e.slice();for(const o of e){const e=n.find(e=>e.agent===o.agent);if(e){if(e.dates.push(o.date),Ee(n)>t){e.dates.pop();break}}else if(n.push({agent:o.agent,dates:[o.date]}),Ee(n)>t){n.pop();break}i=i.slice(1)}return{heartbeatsToSend:n,unsentEntries:i}}class Oe{constructor(e){this.app=e,this._canUseIndexedDBPromise=this.runIndexedDBEnvironmentCheck()}async runIndexedDBEnvironmentCheck(){return!!(0,n.isIndexedDBAvailable)()&&(0,n.validateIndexedDBOpenable)().then(()=>!0).catch(()=>!1)}async read(){if(await this._canUseIndexedDBPromise){const e=await me(this.app);return e?.heartbeats?e:{heartbeats:[]}}return{heartbeats:[]}}async overwrite(e){if(await this._canUseIndexedDBPromise){const t=await this.read();return ve(this.app,{lastSentHeartbeatDate:e.lastSentHeartbeatDate??t.lastSentHeartbeatDate,heartbeats:e.heartbeats})}}async add(e){if(await this._canUseIndexedDBPromise){const t=await this.read();return ve(this.app,{lastSentHeartbeatDate:e.lastSentHeartbeatDate??t.lastSentHeartbeatDate,heartbeats:[...t.heartbeats,...e.heartbeats]})}}}function Ee(e){return(0,n.base64urlEncodeWithoutPadding)(JSON.stringify({version:2,heartbeats:e})).length}function Pe(e){if(0===e.length)return-1;let t=0,n=e[0].date;for(let i=1;i<e.length;i++)e[i].date<n&&(n=e[i].date,t=i);return t}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */var Se;Se='',q(new e.Component('platform-logger',e=>new o(e),"PRIVATE")),q(new e.Component('heartbeat',e=>new ye(e),"PRIVATE")),le(c,p,Se),le(c,p,'esm2020'),le('fire-js','')},1368,[1369,1372,1370,1373]);
__d(function(g,r,i,a,m,_e,d){"use strict";Object.defineProperty(_e,'__esModule',{value:!0}),Object.defineProperty(_e,"Component",{enumerable:!0,get:function(){return t}}),Object.defineProperty(_e,"ComponentContainer",{enumerable:!0,get:function(){return c}}),Object.defineProperty(_e,"Provider",{enumerable:!0,get:function(){return s}});var e=r(d[0]);class t{constructor(e,t,n){this.name=e,this.instanceFactory=t,this.type=n,this.multipleInstances=!1,this.serviceProps={},this.instantiationMode="LAZY",this.onInstanceCreated=null}setInstantiationMode(e){return this.instantiationMode=e,this}setMultipleInstances(e){return this.multipleInstances=e,this}setServiceProps(e){return this.serviceProps=e,this}setInstanceCreatedCallback(e){return this.onInstanceCreated=e,this}}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const n='[DEFAULT]';
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class s{constructor(e,t){this.name=e,this.container=t,this.component=null,this.instances=new Map,this.instancesDeferred=new Map,this.instancesOptions=new Map,this.onInitCallbacks=new Map}get(t){const n=this.normalizeInstanceIdentifier(t);if(!this.instancesDeferred.has(n)){const t=new e.Deferred;if(this.instancesDeferred.set(n,t),this.isInitialized(n)||this.shouldAutoInitialize())try{const e=this.getOrInitializeService({instanceIdentifier:n});e&&t.resolve(e)}catch(e){}}return this.instancesDeferred.get(n).promise}getImmediate(e){const t=this.normalizeInstanceIdentifier(e?.identifier),n=e?.optional??!1;if(!this.isInitialized(t)&&!this.shouldAutoInitialize()){if(n)return null;throw Error(`Service ${this.name} is not available`)}try{return this.getOrInitializeService({instanceIdentifier:t})}catch(e){if(n)return null;throw e}}getComponent(){return this.component}setComponent(e){if(e.name!==this.name)throw Error(`Mismatching Component ${e.name} for Provider ${this.name}.`);if(this.component)throw Error(`Component for ${this.name} has already been provided`);if(this.component=e,this.shouldAutoInitialize()){if(o(e))try{this.getOrInitializeService({instanceIdentifier:n})}catch(e){}for(const[e,t]of this.instancesDeferred.entries()){const n=this.normalizeInstanceIdentifier(e);try{const e=this.getOrInitializeService({instanceIdentifier:n});t.resolve(e)}catch(e){}}}}clearInstance(e=n){this.instancesDeferred.delete(e),this.instancesOptions.delete(e),this.instances.delete(e)}async delete(){const e=Array.from(this.instances.values());await Promise.all([...e.filter(e=>'INTERNAL'in e).map(e=>e.INTERNAL.delete()),...e.filter(e=>'_delete'in e).map(e=>e._delete())])}isComponentSet(){return null!=this.component}isInitialized(e=n){return this.instances.has(e)}getOptions(e=n){return this.instancesOptions.get(e)||{}}initialize(e={}){const{options:t={}}=e,n=this.normalizeInstanceIdentifier(e.instanceIdentifier);if(this.isInitialized(n))throw Error(`${this.name}(${n}) has already been initialized`);if(!this.isComponentSet())throw Error(`Component ${this.name} has not been registered yet`);const s=this.getOrInitializeService({instanceIdentifier:n,options:t});for(const[e,t]of this.instancesDeferred.entries()){n===this.normalizeInstanceIdentifier(e)&&t.resolve(s)}return s}onInit(e,t){const n=this.normalizeInstanceIdentifier(t),s=this.onInitCallbacks.get(n)??new Set;s.add(e),this.onInitCallbacks.set(n,s);const o=this.instances.get(n);return o&&e(o,n),()=>{s.delete(e)}}invokeOnInitCallbacks(e,t){const n=this.onInitCallbacks.get(t);if(n)for(const s of n)try{s(e,t)}catch{}}getOrInitializeService({instanceIdentifier:e,options:t={}}){let s=this.instances.get(e);if(!s&&this.component&&(s=this.component.instanceFactory(this.container,{instanceIdentifier:(o=e,o===n?void 0:o),options:t}),this.instances.set(e,s),this.instancesOptions.set(e,t),this.invokeOnInitCallbacks(s,e),this.component.onInstanceCreated))try{this.component.onInstanceCreated(this.container,e,s)}catch{}var o;return s||null}normalizeInstanceIdentifier(e=n){return this.component?this.component.multipleInstances?e:n:e}shouldAutoInitialize(){return!!this.component&&"EXPLICIT"!==this.component.instantiationMode}}function o(e){return"EAGER"===e.instantiationMode}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class c{constructor(e){this.name=e,this.providers=new Map}addComponent(e){const t=this.getProvider(e.name);if(t.isComponentSet())throw new Error(`Component ${e.name} has already been registered with ${this.name}`);t.setComponent(e)}addOrOverwriteComponent(e){this.getProvider(e.name).isComponentSet()&&this.providers.delete(e.name),this.addComponent(e)}getProvider(e){if(this.providers.has(e))return this.providers.get(e);const t=new s(e,this);return this.providers.set(e,t),t}getProviders(){return Array.from(this.providers.values())}}},1369,[1370]);
__d(function(g,r,_i,_a,m,_e,_d){"use strict";Object.defineProperty(_e,'__esModule',{value:!0}),Object.defineProperty(_e,"CONSTANTS",{enumerable:!0,get:function(){return t}}),Object.defineProperty(_e,"DecodeBase64StringError",{enumerable:!0,get:function(){return u}}),Object.defineProperty(_e,"Deferred",{enumerable:!0,get:function(){return P}}),Object.defineProperty(_e,"ErrorFactory",{enumerable:!0,get:function(){return X}}),Object.defineProperty(_e,"FirebaseError",{enumerable:!0,get:function(){return Q}}),Object.defineProperty(_e,"MAX_VALUE_MILLIS",{enumerable:!0,get:function(){return Ne}}),Object.defineProperty(_e,"RANDOM_FACTOR",{enumerable:!0,get:function(){return Be}}),Object.defineProperty(_e,"Sha1",{enumerable:!0,get:function(){return me}}),Object.defineProperty(_e,"areCookiesEnabled",{enumerable:!0,get:function(){return K}}),Object.defineProperty(_e,"assert",{enumerable:!0,get:function(){return n}}),Object.defineProperty(_e,"assertionError",{enumerable:!0,get:function(){return o}}),Object.defineProperty(_e,"async",{enumerable:!0,get:function(){return je}}),Object.defineProperty(_e,"base64",{enumerable:!0,get:function(){return s}}),Object.defineProperty(_e,"base64Decode",{enumerable:!0,get:function(){return l}}),Object.defineProperty(_e,"base64Encode",{enumerable:!0,get:function(){return a}}),Object.defineProperty(_e,"base64urlEncodeWithoutPadding",{enumerable:!0,get:function(){return f}}),Object.defineProperty(_e,"calculateBackoffMillis",{enumerable:!0,get:function(){return Ie}}),Object.defineProperty(_e,"contains",{enumerable:!0,get:function(){return ue}}),Object.defineProperty(_e,"createMockUserToken",{enumerable:!0,get:function(){return w}}),Object.defineProperty(_e,"createSubscribe",{enumerable:!0,get:function(){return Oe}}),Object.defineProperty(_e,"decode",{enumerable:!0,get:function(){return ne}}),Object.defineProperty(_e,"deepCopy",{enumerable:!0,get:function(){return d}}),Object.defineProperty(_e,"deepEqual",{enumerable:!0,get:function(){return de}}),Object.defineProperty(_e,"deepExtend",{enumerable:!0,get:function(){return h}}),Object.defineProperty(_e,"errorPrefix",{enumerable:!0,get:function(){return Ae}}),Object.defineProperty(_e,"extractQuerystring",{enumerable:!0,get:function(){return ye}}),Object.defineProperty(_e,"generateSHA256Hash",{enumerable:!0,get:function(){return Ue}}),Object.defineProperty(_e,"getDefaultAppConfig",{enumerable:!0,get:function(){return C}}),Object.defineProperty(_e,"getDefaultEmulatorHost",{enumerable:!0,get:function(){return E}}),Object.defineProperty(_e,"getDefaultEmulatorHostnameAndPort",{enumerable:!0,get:function(){return j}}),Object.defineProperty(_e,"getDefaults",{enumerable:!0,get:function(){return O}}),Object.defineProperty(_e,"getExperimentalSetting",{enumerable:!0,get:function(){return v}}),Object.defineProperty(_e,"getGlobal",{enumerable:!0,get:function(){return p}}),Object.defineProperty(_e,"getModularInstance",{enumerable:!0,get:function(){return Re}}),Object.defineProperty(_e,"getUA",{enumerable:!0,get:function(){return N}}),Object.defineProperty(_e,"isAdmin",{enumerable:!0,get:function(){return se}}),Object.defineProperty(_e,"isBrowser",{enumerable:!0,get:function(){return L}}),Object.defineProperty(_e,"isBrowserExtension",{enumerable:!0,get:function(){return U}}),Object.defineProperty(_e,"isCloudWorkstation",{enumerable:!0,get:function(){return A}}),Object.defineProperty(_e,"isCloudflareWorker",{enumerable:!0,get:function(){return R}}),Object.defineProperty(_e,"isElectron",{enumerable:!0,get:function(){return F}}),Object.defineProperty(_e,"isEmpty",{enumerable:!0,get:function(){return fe}}),Object.defineProperty(_e,"isIE",{enumerable:!0,get:function(){return H}}),Object.defineProperty(_e,"isIndexedDBAvailable",{enumerable:!0,get:function(){return G}}),Object.defineProperty(_e,"isMobileCordova",{enumerable:!0,get:function(){return B}}),Object.defineProperty(_e,"isNode",{enumerable:!0,get:function(){return I}}),Object.defineProperty(_e,"isNodeSdk",{enumerable:!0,get:function(){return z}}),Object.defineProperty(_e,"isReactNative",{enumerable:!0,get:function(){return V}}),Object.defineProperty(_e,"isSafari",{enumerable:!0,get:function(){return J}}),Object.defineProperty(_e,"isSafariOrWebkit",{enumerable:!0,get:function(){return Z}}),Object.defineProperty(_e,"isUWP",{enumerable:!0,get:function(){return $}}),Object.defineProperty(_e,"isValidFormat",{enumerable:!0,get:function(){return ce}}),Object.defineProperty(_e,"isValidTimestamp",{enumerable:!0,get:function(){return oe}}),Object.defineProperty(_e,"isWebWorker",{enumerable:!0,get:function(){return W}}),Object.defineProperty(_e,"issuedAtTime",{enumerable:!0,get:function(){return ie}}),Object.defineProperty(_e,"jsonEval",{enumerable:!0,get:function(){return te}}),Object.defineProperty(_e,"map",{enumerable:!0,get:function(){return le}}),Object.defineProperty(_e,"ordinal",{enumerable:!0,get:function(){return Le}}),Object.defineProperty(_e,"pingServer",{enumerable:!0,get:function(){return S}}),Object.defineProperty(_e,"promiseWithTimeout",{enumerable:!0,get:function(){return be}}),Object.defineProperty(_e,"querystring",{enumerable:!0,get:function(){return pe}}),Object.defineProperty(_e,"querystringDecode",{enumerable:!0,get:function(){return ge}}),Object.defineProperty(_e,"safeGet",{enumerable:!0,get:function(){return ae}}),Object.defineProperty(_e,"stringLength",{enumerable:!0,get:function(){return ke}}),Object.defineProperty(_e,"stringToByteArray",{enumerable:!0,get:function(){return De}}),Object.defineProperty(_e,"stringify",{enumerable:!0,get:function(){return re}}),Object.defineProperty(_e,"updateEmulatorBanner",{enumerable:!0,get:function(){return x}}),Object.defineProperty(_e,"validateArgCount",{enumerable:!0,get:function(){return Pe}}),Object.defineProperty(_e,"validateCallback",{enumerable:!0,get:function(){return we}}),Object.defineProperty(_e,"validateContextObject",{enumerable:!0,get:function(){return Te}}),Object.defineProperty(_e,"validateIndexedDBOpenable",{enumerable:!0,get:function(){return q}}),Object.defineProperty(_e,"validateNamespace",{enumerable:!0,get:function(){return Se}});var e=r(_d[0]);
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const t={NODE_CLIENT:!1,NODE_ADMIN:!1,SDK_VERSION:'${JSCORE_VERSION}'},n=function(e,t){if(!e)throw o(t)},o=function(e){return new Error('Firebase Database ('+t.SDK_VERSION+') INTERNAL ASSERT FAILED: '+e)},i=function(e){const t=[];let n=0;for(let o=0;o<e.length;o++){let i=e.charCodeAt(o);i<128?t[n++]=i:i<2048?(t[n++]=i>>6|192,t[n++]=63&i|128):55296==(64512&i)&&o+1<e.length&&56320==(64512&e.charCodeAt(o+1))?(i=65536+((1023&i)<<10)+(1023&e.charCodeAt(++o)),t[n++]=i>>18|240,t[n++]=i>>12&63|128,t[n++]=i>>6&63|128,t[n++]=63&i|128):(t[n++]=i>>12|224,t[n++]=i>>6&63|128,t[n++]=63&i|128)}return t},c=function(e){const t=[];let n=0,o=0;for(;n<e.length;){const i=e[n++];if(i<128)t[o++]=String.fromCharCode(i);else if(i>191&&i<224){const c=e[n++];t[o++]=String.fromCharCode((31&i)<<6|63&c)}else if(i>239&&i<365){const c=((7&i)<<18|(63&e[n++])<<12|(63&e[n++])<<6|63&e[n++])-65536;t[o++]=String.fromCharCode(55296+(c>>10)),t[o++]=String.fromCharCode(56320+(1023&c))}else{const c=e[n++],s=e[n++];t[o++]=String.fromCharCode((15&i)<<12|(63&c)<<6|63&s)}}return t.join('')},s={byteToCharMap_:null,charToByteMap_:null,byteToCharMapWebSafe_:null,charToByteMapWebSafe_:null,ENCODED_VALS_BASE:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",get ENCODED_VALS(){return this.ENCODED_VALS_BASE+'+/='},get ENCODED_VALS_WEBSAFE(){return this.ENCODED_VALS_BASE+'-_.'},HAS_NATIVE_SUPPORT:'function'==typeof atob,encodeByteArray(e,t){if(!Array.isArray(e))throw Error('encodeByteArray takes an array as a parameter');this.init_();const n=t?this.byteToCharMapWebSafe_:this.byteToCharMap_,o=[];for(let t=0;t<e.length;t+=3){const i=e[t],c=t+1<e.length,s=c?e[t+1]:0,u=t+2<e.length,a=u?e[t+2]:0,f=i>>2,l=(3&i)<<4|s>>4;let d=(15&s)<<2|a>>6,h=63&a;u||(h=64,c||(d=64)),o.push(n[f],n[l],n[d],n[h])}return o.join('')},encodeString(e,t){return this.HAS_NATIVE_SUPPORT&&!t?btoa(e):this.encodeByteArray(i(e),t)},decodeString(e,t){return this.HAS_NATIVE_SUPPORT&&!t?atob(e):c(this.decodeStringToByteArray(e,t))},decodeStringToByteArray(e,t){this.init_();const n=t?this.charToByteMapWebSafe_:this.charToByteMap_,o=[];for(let t=0;t<e.length;){const i=n[e.charAt(t++)],c=t<e.length?n[e.charAt(t)]:0;++t;const s=t<e.length?n[e.charAt(t)]:64;++t;const a=t<e.length?n[e.charAt(t)]:64;if(++t,null==i||null==c||null==s||null==a)throw new u;const f=i<<2|c>>4;if(o.push(f),64!==s){const e=c<<4&240|s>>2;if(o.push(e),64!==a){const e=s<<6&192|a;o.push(e)}}}return o},init_(){if(!this.byteToCharMap_){this.byteToCharMap_={},this.charToByteMap_={},this.byteToCharMapWebSafe_={},this.charToByteMapWebSafe_={};for(let e=0;e<this.ENCODED_VALS.length;e++)this.byteToCharMap_[e]=this.ENCODED_VALS.charAt(e),this.charToByteMap_[this.byteToCharMap_[e]]=e,this.byteToCharMapWebSafe_[e]=this.ENCODED_VALS_WEBSAFE.charAt(e),this.charToByteMapWebSafe_[this.byteToCharMapWebSafe_[e]]=e,e>=this.ENCODED_VALS_BASE.length&&(this.charToByteMap_[this.ENCODED_VALS_WEBSAFE.charAt(e)]=e,this.charToByteMapWebSafe_[this.ENCODED_VALS.charAt(e)]=e)}}};
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class u extends Error{constructor(){super(...arguments),this.name='DecodeBase64StringError'}}const a=function(e){const t=i(e);return s.encodeByteArray(t,!0)},f=function(e){return a(e).replace(/\./g,'')},l=function(e){try{return s.decodeString(e,!0)}catch(e){console.error('base64Decode failed: ',e)}return null};
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
function d(e){return h(void 0,e)}function h(e,t){if(!(t instanceof Object))return t;switch(t.constructor){case Date:return new Date(t.getTime());case Object:void 0===e&&(e={});break;case Array:e=[];break;default:return t}for(const n in t)t.hasOwnProperty(n)&&b(n)&&(e[n]=h(e[n],t[n]));return e}function b(e){return'__proto__'!==e}
/**
   * @license
   * Copyright 2022 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function p(){if('undefined'!=typeof self)return self;if('undefined'!=typeof window)return window;if(void 0!==g)return g;throw new Error('Unable to locate global object.')}
/**
   * @license
   * Copyright 2022 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const y=()=>{if('undefined'==typeof process||void 0===process.env)return;const e=process.env.__FIREBASE_DEFAULTS__;return e?JSON.parse(e):void 0},_=()=>{if('undefined'==typeof document)return;let e;try{e=document.cookie.match(/__FIREBASE_DEFAULTS__=([^;]+)/)}catch(e){return}const t=e&&l(e[1]);return t&&JSON.parse(t)},O=()=>{try{return(0,e.getDefaultsFromPostinstall)()||p().__FIREBASE_DEFAULTS__||y()||_()}catch(e){return void console.info(`Unable to get __FIREBASE_DEFAULTS__ due to: ${e}`)}},E=e=>O()?.emulatorHosts?.[e],j=e=>{const t=E(e);if(!t)return;const n=t.lastIndexOf(':');if(n<=0||n+1===t.length)throw new Error(`Invalid host ${t} with no separate hostname and port!`);const o=parseInt(t.substring(n+1),10);return'['===t[0]?[t.substring(1,n-1),o]:[t.substring(0,n),o]},C=()=>O()?.config,v=e=>O()?.[`_${e}`];
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
class P{constructor(){this.reject=()=>{},this.resolve=()=>{},this.promise=new Promise((e,t)=>{this.resolve=e,this.reject=t})}wrapCallback(e){return(t,n)=>{t?this.reject(t):this.resolve(n),'function'==typeof e&&(this.promise.catch(()=>{}),1===e.length?e(t):e(t,n))}}}
/**
   * @license
   * Copyright 2025 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function A(e){try{return(e.startsWith('http://')||e.startsWith('https://')?new URL(e).hostname:e).endsWith('.cloudworkstations.dev')}catch{return!1}}async function S(e){return(await fetch(e,{credentials:'include'})).ok}
/**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function w(e,t){if(e.uid)throw new Error('The "uid" field is no longer supported by mockUserToken. Please use "sub" instead for Firebase Auth User ID.');const n=t||'demo-project',o=e.iat||0,i=e.sub||e.user_id;if(!i)throw new Error("mockUserToken must contain 'sub' or 'user_id' field!");const c=Object.assign({iss:`https://securetoken.google.com/${n}`,aud:n,iat:o,exp:o+3600,auth_time:o,sub:i,user_id:i,firebase:{sign_in_provider:'custom',identities:{}}},e);return[f(JSON.stringify({alg:'none',type:'JWT'})),f(JSON.stringify(c)),''].join('.')}const T={};function D(){const e={prod:[],emulator:[]};for(const t of Object.keys(T))T[t]?e.emulator.push(t):e.prod.push(t);return e}function k(e){let t=document.getElementById(e),n=!1;return t||(t=document.createElement('div'),t.setAttribute('id',e),n=!0),{created:n,element:t}}let M=!1;function x(e,t){if('undefined'==typeof window||'undefined'==typeof document||!A(window.location.host)||T[e]===t||T[e]||M)return;function n(e){return`__firebase__banner__${e}`}T[e]=t;const o='__firebase__banner',i=D().prod.length>0;function c(){const e=document.getElementById(o);e&&e.remove()}function s(e){e.style.display='flex',e.style.background='#7faaf0',e.style.position='fixed',e.style.bottom='5px',e.style.left='5px',e.style.padding='.5em',e.style.borderRadius='5px',e.style.alignItems='center'}function u(e,t){e.setAttribute('width','24'),e.setAttribute('id',t),e.setAttribute('height','24'),e.setAttribute('viewBox','0 0 24 24'),e.setAttribute('fill','none'),e.style.marginLeft='-6px'}function a(){const e=document.createElement('span');return e.style.cursor='pointer',e.style.marginLeft='16px',e.style.fontSize='24px',e.innerHTML=' &times;',e.onclick=()=>{M=!0,c()},e}function f(e,t){e.setAttribute('id',t),e.innerText='Learn more',e.href='https://firebase.google.com/docs/studio/preview-apps#preview-backend',e.setAttribute('target','__blank'),e.style.paddingLeft='5px',e.style.textDecoration='underline'}function l(){const e=k(o),t=n('text'),c=document.getElementById(t)||document.createElement('span'),l=n('learnmore'),d=document.getElementById(l)||document.createElement('a'),h=n('preprendIcon'),b=document.getElementById(h)||document.createElementNS('http://www.w3.org/2000/svg','svg');if(e.created){const t=e.element;s(t),f(d,l);const n=a();u(b,h),t.append(b,c,d,n),document.body.appendChild(t)}i?(c.innerText="Preview backend disconnected.",b.innerHTML="<g clip-path=\"url(#clip0_6013_33858)\">\n<path d=\"M4.8 17.6L12 5.6L19.2 17.6H4.8ZM6.91667 16.4H17.0833L12 7.93333L6.91667 16.4ZM12 15.6C12.1667 15.6 12.3056 15.5444 12.4167 15.4333C12.5389 15.3111 12.6 15.1667 12.6 15C12.6 14.8333 12.5389 14.6944 12.4167 14.5833C12.3056 14.4611 12.1667 14.4 12 14.4C11.8333 14.4 11.6889 14.4611 11.5667 14.5833C11.4556 14.6944 11.4 14.8333 11.4 15C11.4 15.1667 11.4556 15.3111 11.5667 15.4333C11.6889 15.5444 11.8333 15.6 12 15.6ZM11.4 13.6H12.6V10.4H11.4V13.6Z\" fill=\"#212121\"/>\n</g>\n<defs>\n<clipPath id=\"clip0_6013_33858\">\n<rect width=\"24\" height=\"24\" fill=\"white\"/>\n</clipPath>\n</defs>"):(b.innerHTML="<g clip-path=\"url(#clip0_6083_34804)\">\n<path d=\"M11.4 15.2H12.6V11.2H11.4V15.2ZM12 10C12.1667 10 12.3056 9.94444 12.4167 9.83333C12.5389 9.71111 12.6 9.56667 12.6 9.4C12.6 9.23333 12.5389 9.09444 12.4167 8.98333C12.3056 8.86111 12.1667 8.8 12 8.8C11.8333 8.8 11.6889 8.86111 11.5667 8.98333C11.4556 9.09444 11.4 9.23333 11.4 9.4C11.4 9.56667 11.4556 9.71111 11.5667 9.83333C11.6889 9.94444 11.8333 10 12 10ZM12 18.4C11.1222 18.4 10.2944 18.2333 9.51667 17.9C8.73889 17.5667 8.05556 17.1111 7.46667 16.5333C6.88889 15.9444 6.43333 15.2611 6.1 14.4833C5.76667 13.7056 5.6 12.8778 5.6 12C5.6 11.1111 5.76667 10.2833 6.1 9.51667C6.43333 8.73889 6.88889 8.06111 7.46667 7.48333C8.05556 6.89444 8.73889 6.43333 9.51667 6.1C10.2944 5.76667 11.1222 5.6 12 5.6C12.8889 5.6 13.7167 5.76667 14.4833 6.1C15.2611 6.43333 15.9389 6.89444 16.5167 7.48333C17.1056 8.06111 17.5667 8.73889 17.9 9.51667C18.2333 10.2833 18.4 11.1111 18.4 12C18.4 12.8778 18.2333 13.7056 17.9 14.4833C17.5667 15.2611 17.1056 15.9444 16.5167 16.5333C15.9389 17.1111 15.2611 17.5667 14.4833 17.9C13.7167 18.2333 12.8889 18.4 12 18.4ZM12 17.2C13.4444 17.2 14.6722 16.6944 15.6833 15.6833C16.6944 14.6722 17.2 13.4444 17.2 12C17.2 10.5556 16.6944 9.32778 15.6833 8.31667C14.6722 7.30555 13.4444 6.8 12 6.8C10.5556 6.8 9.32778 7.30555 8.31667 8.31667C7.30556 9.32778 6.8 10.5556 6.8 12C6.8 13.4444 7.30556 14.6722 8.31667 15.6833C9.32778 16.6944 10.5556 17.2 12 17.2Z\" fill=\"#212121\"/>\n</g>\n<defs>\n<clipPath id=\"clip0_6083_34804\">\n<rect width=\"24\" height=\"24\" fill=\"white\"/>\n</clipPath>\n</defs>",c.innerText='Preview backend running in this workspace.'),c.setAttribute('id',t)}'loading'===document.readyState?window.addEventListener('DOMContentLoaded',l):l()}
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function N(){return'undefined'!=typeof navigator&&'string'==typeof navigator.userAgent?navigator.userAgent:''}function B(){return'undefined'!=typeof window&&!!(window.cordova||window.phonegap||window.PhoneGap)&&/ios|iphone|ipod|ipad|android|blackberry|iemobile/i.test(N())}function I(){const e=O()?.forceEnvironment;if('node'===e)return!0;if('browser'===e)return!1;try{return'[object process]'===Object.prototype.toString.call(g.process)}catch(e){return!1}}function L(){return'undefined'!=typeof window||W()}function W(){return'undefined'!=typeof WorkerGlobalScope&&'undefined'!=typeof self&&self instanceof WorkerGlobalScope}function R(){return'undefined'!=typeof navigator&&'Cloudflare-Workers'===navigator.userAgent}function U(){const e='object'==typeof chrome?chrome.runtime:'object'==typeof browser?browser.runtime:void 0;return'object'==typeof e&&void 0!==e.id}function V(){return'object'==typeof navigator&&'ReactNative'===navigator.product}function F(){return N().indexOf('Electron/')>=0}function H(){const e=N();return e.indexOf('MSIE ')>=0||e.indexOf('Trident/')>=0}function $(){return N().indexOf('MSAppHost/')>=0}function z(){return!0===t.NODE_CLIENT||!0===t.NODE_ADMIN}function J(){return!I()&&!!navigator.userAgent&&navigator.userAgent.includes('Safari')&&!navigator.userAgent.includes('Chrome')}function Z(){return!I()&&!!navigator.userAgent&&(navigator.userAgent.includes('Safari')||navigator.userAgent.includes('WebKit'))&&!navigator.userAgent.includes('Chrome')}function G(){try{return'object'==typeof indexedDB}catch(e){return!1}}function q(){return new Promise((e,t)=>{try{let n=!0;const o='validate-browser-context-for-indexeddb-analytics-module',i=self.indexedDB.open(o);i.onsuccess=()=>{i.result.close(),n||self.indexedDB.deleteDatabase(o),e(!0)},i.onupgradeneeded=()=>{n=!1},i.onerror=()=>{t(i.error?.message||'')}}catch(e){t(e)}})}function K(){return!('undefined'==typeof navigator||!navigator.cookieEnabled)}
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Q extends Error{constructor(e,t,n){super(t),this.code=e,this.customData=n,this.name="FirebaseError",Object.setPrototypeOf(this,Q.prototype),Error.captureStackTrace&&Error.captureStackTrace(this,X.prototype.create)}}class X{constructor(e,t,n){this.service=e,this.serviceName=t,this.errors=n}create(e,...t){const n=t[0]||{},o=`${this.service}/${e}`,i=this.errors[e],c=i?Y(i,n):'Error',s=`${this.serviceName}: ${c} (${o}).`;return new Q(o,s,n)}}function Y(e,t){return e.replace(ee,(e,n)=>{const o=t[n];return null!=o?String(o):`<${n}?>`})}const ee=/\{\$([^}]+)}/g;
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function te(e){return JSON.parse(e)}function re(e){return JSON.stringify(e)}
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const ne=function(e){let t={},n={},o={},i='';try{const c=e.split('.');t=te(l(c[0])||''),n=te(l(c[1])||''),i=c[2],o=n.d||{},delete n.d}catch(e){}return{header:t,claims:n,data:o,signature:i}},oe=function(e){const t=ne(e).claims,n=Math.floor((new Date).getTime()/1e3);let o=0,i=0;return'object'==typeof t&&(t.hasOwnProperty('nbf')?o=t.nbf:t.hasOwnProperty('iat')&&(o=t.iat),i=t.hasOwnProperty('exp')?t.exp:o+86400),!!n&&!!o&&!!i&&n>=o&&n<=i},ie=function(e){const t=ne(e).claims;return'object'==typeof t&&t.hasOwnProperty('iat')?t.iat:null},ce=function(e){const t=ne(e).claims;return!!t&&'object'==typeof t&&t.hasOwnProperty('iat')},se=function(e){const t=ne(e).claims;return'object'==typeof t&&!0===t.admin};
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
function ue(e,t){return Object.prototype.hasOwnProperty.call(e,t)}function ae(e,t){return Object.prototype.hasOwnProperty.call(e,t)?e[t]:void 0}function fe(e){for(const t in e)if(Object.prototype.hasOwnProperty.call(e,t))return!1;return!0}function le(e,t,n){const o={};for(const i in e)Object.prototype.hasOwnProperty.call(e,i)&&(o[i]=t.call(n,e[i],i,e));return o}function de(e,t){if(e===t)return!0;const n=Object.keys(e),o=Object.keys(t);for(const i of n){if(!o.includes(i))return!1;const n=e[i],c=t[i];if(he(n)&&he(c)){if(!de(n,c))return!1}else if(n!==c)return!1}for(const e of o)if(!n.includes(e))return!1;return!0}function he(e){return null!==e&&'object'==typeof e}
/**
   * @license
   * Copyright 2022 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function be(e,t=2e3){const n=new P;return setTimeout(()=>n.reject('timeout!'),t),e.then(n.resolve,n.reject),n.promise}
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function pe(e){const t=[];for(const[n,o]of Object.entries(e))Array.isArray(o)?o.forEach(e=>{t.push(encodeURIComponent(n)+'='+encodeURIComponent(e))}):t.push(encodeURIComponent(n)+'='+encodeURIComponent(o));return t.length?'&'+t.join('&'):''}function ge(e){const t={};return e.replace(/^\?/,'').split('&').forEach(e=>{if(e){const[n,o]=e.split('=');t[decodeURIComponent(n)]=decodeURIComponent(o)}}),t}function ye(e){const t=e.indexOf('?');if(!t)return'';const n=e.indexOf('#',t);return e.substring(t,n>0?n:void 0)}
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class me{constructor(){this.chain_=[],this.buf_=[],this.W_=[],this.pad_=[],this.inbuf_=0,this.total_=0,this.blockSize=64,this.pad_[0]=128;for(let e=1;e<this.blockSize;++e)this.pad_[e]=0;this.reset()}reset(){this.chain_[0]=1732584193,this.chain_[1]=4023233417,this.chain_[2]=2562383102,this.chain_[3]=271733878,this.chain_[4]=3285377520,this.inbuf_=0,this.total_=0}compress_(e,t){t||(t=0);const n=this.W_;if('string'==typeof e)for(let o=0;o<16;o++)n[o]=e.charCodeAt(t)<<24|e.charCodeAt(t+1)<<16|e.charCodeAt(t+2)<<8|e.charCodeAt(t+3),t+=4;else for(let o=0;o<16;o++)n[o]=e[t]<<24|e[t+1]<<16|e[t+2]<<8|e[t+3],t+=4;for(let e=16;e<80;e++){const t=n[e-3]^n[e-8]^n[e-14]^n[e-16];n[e]=4294967295&(t<<1|t>>>31)}let o,i,c=this.chain_[0],s=this.chain_[1],u=this.chain_[2],a=this.chain_[3],f=this.chain_[4];for(let e=0;e<80;e++){e<40?e<20?(o=a^s&(u^a),i=1518500249):(o=s^u^a,i=1859775393):e<60?(o=s&u|a&(s|u),i=2400959708):(o=s^u^a,i=3395469782);const t=(c<<5|c>>>27)+o+f+i+n[e]&4294967295;f=a,a=u,u=4294967295&(s<<30|s>>>2),s=c,c=t}this.chain_[0]=this.chain_[0]+c&4294967295,this.chain_[1]=this.chain_[1]+s&4294967295,this.chain_[2]=this.chain_[2]+u&4294967295,this.chain_[3]=this.chain_[3]+a&4294967295,this.chain_[4]=this.chain_[4]+f&4294967295}update(e,t){if(null==e)return;void 0===t&&(t=e.length);const n=t-this.blockSize;let o=0;const i=this.buf_;let c=this.inbuf_;for(;o<t;){if(0===c)for(;o<=n;)this.compress_(e,o),o+=this.blockSize;if('string'==typeof e){for(;o<t;)if(i[c]=e.charCodeAt(o),++c,++o,c===this.blockSize){this.compress_(i),c=0;break}}else for(;o<t;)if(i[c]=e[o],++c,++o,c===this.blockSize){this.compress_(i),c=0;break}}this.inbuf_=c,this.total_+=t}digest(){const e=[];let t=8*this.total_;this.inbuf_<56?this.update(this.pad_,56-this.inbuf_):this.update(this.pad_,this.blockSize-(this.inbuf_-56));for(let e=this.blockSize-1;e>=56;e--)this.buf_[e]=255&t,t/=256;this.compress_(this.buf_);let n=0;for(let t=0;t<5;t++)for(let o=24;o>=0;o-=8)e[n]=this.chain_[t]>>o&255,++n;return e}}function Oe(e,t){const n=new Ee(e,t);return n.subscribe.bind(n)}class Ee{constructor(e,t){this.observers=[],this.unsubscribes=[],this.observerCount=0,this.task=Promise.resolve(),this.finalized=!1,this.onNoObservers=t,this.task.then(()=>{e(this)}).catch(e=>{this.error(e)})}next(e){this.forEachObserver(t=>{t.next(e)})}error(e){this.forEachObserver(t=>{t.error(e)}),this.close(e)}complete(){this.forEachObserver(e=>{e.complete()}),this.close()}subscribe(e,t,n){let o;if(void 0===e&&void 0===t&&void 0===n)throw new Error('Missing Observer.');o=Ce(e,['next','error','complete'])?e:{next:e,error:t,complete:n},void 0===o.next&&(o.next=ve),void 0===o.error&&(o.error=ve),void 0===o.complete&&(o.complete=ve);const i=this.unsubscribeOne.bind(this,this.observers.length);return this.finalized&&this.task.then(()=>{try{this.finalError?o.error(this.finalError):o.complete()}catch(e){}}),this.observers.push(o),i}unsubscribeOne(e){void 0!==this.observers&&void 0!==this.observers[e]&&(delete this.observers[e],this.observerCount-=1,0===this.observerCount&&void 0!==this.onNoObservers&&this.onNoObservers(this))}forEachObserver(e){if(!this.finalized)for(let t=0;t<this.observers.length;t++)this.sendOne(t,e)}sendOne(e,t){this.task.then(()=>{if(void 0!==this.observers&&void 0!==this.observers[e])try{t(this.observers[e])}catch(e){'undefined'!=typeof console&&console.error&&console.error(e)}})}close(e){this.finalized||(this.finalized=!0,void 0!==e&&(this.finalError=e),this.task.then(()=>{this.observers=void 0,this.onNoObservers=void 0}))}}function je(e,t){return(...n)=>{Promise.resolve(!0).then(()=>{e(...n)}).catch(e=>{t&&t(e)})}}function Ce(e,t){if('object'!=typeof e||null===e)return!1;for(const n of t)if(n in e&&'function'==typeof e[n])return!0;return!1}function ve(){}
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const Pe=function(e,t,n,o){let i;if(o<t?i='at least '+t:o>n&&(i=0===n?'none':'no more than '+n),i){throw new Error(e+' failed: Was called with '+o+(1===o?' argument.':' arguments.')+' Expects '+i+'.')}};function Ae(e,t){return`${e} failed: ${t} argument `}function Se(e,t,n){if((!n||t)&&'string'!=typeof t)throw new Error(Ae(e,'namespace')+'must be a valid firebase namespace.')}function we(e,t,n,o){if((!o||n)&&'function'!=typeof n)throw new Error(Ae(e,t)+'must be a valid function.')}function Te(e,t,n,o){if((!o||n)&&('object'!=typeof n||null===n))throw new Error(Ae(e,t)+'must be a valid context object.')}
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const De=function(e){const t=[];let o=0;for(let i=0;i<e.length;i++){let c=e.charCodeAt(i);if(c>=55296&&c<=56319){const t=c-55296;i++,n(i<e.length,'Surrogate pair missing trail surrogate.');c=65536+(t<<10)+(e.charCodeAt(i)-56320)}c<128?t[o++]=c:c<2048?(t[o++]=c>>6|192,t[o++]=63&c|128):c<65536?(t[o++]=c>>12|224,t[o++]=c>>6&63|128,t[o++]=63&c|128):(t[o++]=c>>18|240,t[o++]=c>>12&63|128,t[o++]=c>>6&63|128,t[o++]=63&c|128)}return t},ke=function(e){let t=0;for(let n=0;n<e.length;n++){const o=e.charCodeAt(n);o<128?t++:o<2048?t+=2:o>=55296&&o<=56319?(t+=4,n++):t+=3}return t},Me=1e3,xe=2,Ne=144e5,Be=.5;function Ie(e,t=Me,n=xe){const o=t*Math.pow(n,e),i=Math.round(Be*o*(Math.random()-.5)*2);return Math.min(Ne,o+i)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Le(e){return Number.isFinite(e)?e+We(e):`${e}`}function We(e){const t=(e=Math.abs(e))%100;if(t>=10&&t<=20)return'th';const n=e%10;return 1===n?'st':2===n?'nd':3===n?'rd':'th'}
/**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Re(e){return e&&e._delegate?e._delegate:e}
/**
   * @license
   * Copyright 2025 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Ue(e){const t=(new TextEncoder).encode(e),n=await crypto.subtle.digest('SHA-256',t);return Array.from(new Uint8Array(n)).map(e=>e.toString(16).padStart(2,'0')).join('')}},1370,[1371]);
__d(function(g,r,i,a,m,e,d){"use strict";Object.defineProperty(e,'__esModule',{value:!0}),Object.defineProperty(e,"getDefaultsFromPostinstall",{enumerable:!0,get:function(){return t}});const t=()=>{}},1371,[]);
__d(function(g,r,i,a,m,e,d){"use strict";Object.defineProperty(e,'__esModule',{value:!0}),Object.defineProperty(e,"LogLevel",{enumerable:!0,get:function(){return n}}),Object.defineProperty(e,"Logger",{enumerable:!0,get:function(){return h}}),Object.defineProperty(e,"setLogLevel",{enumerable:!0,get:function(){return L}}),Object.defineProperty(e,"setUserLogHandler",{enumerable:!0,get:function(){return f}});
/**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
const t=[];var n;!(function(t){t[t.DEBUG=0]="DEBUG",t[t.VERBOSE=1]="VERBOSE",t[t.INFO=2]="INFO",t[t.WARN=3]="WARN",t[t.ERROR=4]="ERROR",t[t.SILENT=5]="SILENT"})(n||(n={}));const o={debug:n.DEBUG,verbose:n.VERBOSE,info:n.INFO,warn:n.WARN,error:n.ERROR,silent:n.SILENT},l=n.INFO,s={[n.DEBUG]:'log',[n.VERBOSE]:'log',[n.INFO]:'info',[n.WARN]:'warn',[n.ERROR]:'error'},u=(t,n,...o)=>{if(n<t.logLevel)return;const l=(new Date).toISOString(),u=s[n];if(!u)throw new Error(`Attempted to log a message with an invalid logType (value: ${n})`);console[u](`[${l}]  ${t.name}:`,...o)};class h{constructor(n){this.name=n,this._logLevel=l,this._logHandler=u,this._userLogHandler=null,t.push(this)}get logLevel(){return this._logLevel}set logLevel(t){if(!(t in n))throw new TypeError(`Invalid value "${t}" assigned to \`logLevel\``);this._logLevel=t}setLogLevel(t){this._logLevel='string'==typeof t?o[t]:t}get logHandler(){return this._logHandler}set logHandler(t){if('function'!=typeof t)throw new TypeError('Value assigned to `logHandler` must be a function');this._logHandler=t}get userLogHandler(){return this._userLogHandler}set userLogHandler(t){this._userLogHandler=t}debug(...t){this._userLogHandler&&this._userLogHandler(this,n.DEBUG,...t),this._logHandler(this,n.DEBUG,...t)}log(...t){this._userLogHandler&&this._userLogHandler(this,n.VERBOSE,...t),this._logHandler(this,n.VERBOSE,...t)}info(...t){this._userLogHandler&&this._userLogHandler(this,n.INFO,...t),this._logHandler(this,n.INFO,...t)}warn(...t){this._userLogHandler&&this._userLogHandler(this,n.WARN,...t),this._logHandler(this,n.WARN,...t)}error(...t){this._userLogHandler&&this._userLogHandler(this,n.ERROR,...t),this._logHandler(this,n.ERROR,...t)}}function L(n){t.forEach(t=>{t.setLogLevel(n)})}function f(l,s){for(const u of t){let t=null;s&&s.level&&(t=o[s.level]),u.userLogHandler=null===l?null:(o,s,...u)=>{const h=u.map(t=>{if(null==t)return null;if('string'==typeof t)return t;if('number'==typeof t||'boolean'==typeof t)return t.toString();if(t instanceof Error)return t.message;try{return JSON.stringify(t)}catch(t){return null}}).filter(t=>t).join(' ');s>=(t??o.logLevel)&&l({level:n[s].toLowerCase(),message:h,args:u,type:o.name})}}}},1372,[]);
__d(function(g,r,i,a,m,e,d){"use strict";Object.defineProperty(e,'__esModule',{value:!0}),Object.defineProperty(e,"unwrap",{enumerable:!0,get:function(){return n.u}}),Object.defineProperty(e,"wrap",{enumerable:!0,get:function(){return n.w}}),Object.defineProperty(e,"deleteDB",{enumerable:!0,get:function(){return o}}),Object.defineProperty(e,"openDB",{enumerable:!0,get:function(){return t}});var n=r(d[0]);function t(t,o,{blocked:s,upgrade:c,blocking:u,terminated:l}={}){const f=indexedDB.open(t,o),b=(0,n.w)(f);return c&&f.addEventListener('upgradeneeded',t=>{c((0,n.w)(f.result),t.oldVersion,t.newVersion,(0,n.w)(f.transaction),t)}),s&&f.addEventListener('blocked',n=>s(n.oldVersion,n.newVersion,n)),b.then(n=>{l&&n.addEventListener('close',()=>l()),u&&n.addEventListener('versionchange',n=>u(n.oldVersion,n.newVersion,n))}).catch(()=>{}),b}function o(t,{blocked:o}={}){const s=indexedDB.deleteDatabase(t);return o&&s.addEventListener('blocked',n=>o(n.oldVersion,n)),(0,n.w)(s).then(()=>{})}const s=['get','getKey','getAll','getAllKeys','count'],c=['put','add','delete','clear'],u=new Map;function l(n,t){if(!(n instanceof IDBDatabase)||t in n||'string'!=typeof t)return;if(u.get(t))return u.get(t);const o=t.replace(/FromIndex$/,''),l=t!==o,f=c.includes(o);if(!(o in(l?IDBIndex:IDBObjectStore).prototype)||!f&&!s.includes(o))return;const b=async function(n,...t){const s=this.transaction(n,f?'readwrite':'readonly');let c=s.store;return l&&(c=c.index(t.shift())),(await Promise.all([c[o](...t),f&&s.done]))[0]};return u.set(t,b),b}(0,n.r)(n=>Object.assign({},n,{get:(t,o,s)=>l(t,o)||n.get(t,o,s),has:(t,o)=>!!l(t,o)||n.has(t,o)}))},1373,[1374]);
__d(function(g,r,i,a,m,e,d){"use strict";Object.defineProperty(e,'__esModule',{value:!0}),Object.defineProperty(e,"a",{enumerable:!0,get:function(){return p}}),Object.defineProperty(e,"i",{enumerable:!0,get:function(){return t}}),Object.defineProperty(e,"r",{enumerable:!0,get:function(){return l}}),Object.defineProperty(e,"u",{enumerable:!0,get:function(){return B}}),Object.defineProperty(e,"w",{enumerable:!0,get:function(){return I}});const t=(t,n)=>n.some(n=>t instanceof n);let n,o;const s=new WeakMap,c=new WeakMap,u=new WeakMap,f=new WeakMap,p=new WeakMap;function b(t){const n=new Promise((n,o)=>{const s=()=>{t.removeEventListener('success',c),t.removeEventListener('error',u)},c=()=>{n(I(t.result)),s()},u=()=>{o(t.error),s()};t.addEventListener('success',c),t.addEventListener('error',u)});return n.then(n=>{n instanceof IDBCursor&&s.set(n,t)}).catch(()=>{}),p.set(n,t),n}function v(t){if(c.has(t))return;const n=new Promise((n,o)=>{const s=()=>{t.removeEventListener('complete',c),t.removeEventListener('error',u),t.removeEventListener('abort',u)},c=()=>{n(),s()},u=()=>{o(t.error||new DOMException('AbortError','AbortError')),s()};t.addEventListener('complete',c),t.addEventListener('error',u),t.addEventListener('abort',u)});c.set(t,n)}let D={get(t,n,o){if(t instanceof IDBTransaction){if('done'===n)return c.get(t);if('objectStoreNames'===n)return t.objectStoreNames||u.get(t);if('store'===n)return o.objectStoreNames[1]?void 0:o.objectStore(o.objectStoreNames[0])}return I(t[n])},set:(t,n,o)=>(t[n]=o,!0),has:(t,n)=>t instanceof IDBTransaction&&('done'===n||'store'===n)||n in t};function l(t){D=t(D)}function y(c){return'function'==typeof c?(f=c)!==IDBDatabase.prototype.transaction||'objectStoreNames'in IDBTransaction.prototype?(o||(o=[IDBCursor.prototype.advance,IDBCursor.prototype.continue,IDBCursor.prototype.continuePrimaryKey])).includes(f)?function(...t){return f.apply(B(this),t),I(s.get(this))}:function(...t){return I(f.apply(B(this),t))}:function(t,...n){const o=f.call(B(this),t,...n);return u.set(o,t.sort?t.sort():[t]),I(o)}:(c instanceof IDBTransaction&&v(c),t(c,n||(n=[IDBDatabase,IDBObjectStore,IDBIndex,IDBCursor,IDBTransaction]))?new Proxy(c,D):c);var f}function I(t){if(t instanceof IDBRequest)return b(t);if(f.has(t))return f.get(t);const n=y(t);return n!==t&&(f.set(t,n),p.set(n,t)),n}const B=t=>p.get(t)},1374,[]);
__d(function(g,r,i,a,m,e,d){"use strict";Object.defineProperty(e,'__esModule',{value:!0});var t=r(d[0]);Object.keys(t).forEach(function(n){'default'===n||Object.prototype.hasOwnProperty.call(e,n)||Object.defineProperty(e,n,{enumerable:!0,get:function(){return t[n]}})})},1375,[1376]);
__d(function(g,r,i,a,m,e,d){"use strict";Object.defineProperty(e,'__esModule',{value:!0}),Object.defineProperty(e,"ActionCodeOperation",{enumerable:!0,get:function(){return t.A}}),Object.defineProperty(e,"ActionCodeURL",{enumerable:!0,get:function(){return t.aj}}),Object.defineProperty(e,"AuthCredential",{enumerable:!0,get:function(){return t.M}}),Object.defineProperty(e,"AuthErrorCodes",{enumerable:!0,get:function(){return t.J}}),Object.defineProperty(e,"EmailAuthCredential",{enumerable:!0,get:function(){return t.N}}),Object.defineProperty(e,"EmailAuthProvider",{enumerable:!0,get:function(){return t.W}}),Object.defineProperty(e,"FacebookAuthProvider",{enumerable:!0,get:function(){return t.X}}),Object.defineProperty(e,"FactorId",{enumerable:!0,get:function(){return t.F}}),Object.defineProperty(e,"GithubAuthProvider",{enumerable:!0,get:function(){return t.Z}}),Object.defineProperty(e,"GoogleAuthProvider",{enumerable:!0,get:function(){return t.Y}}),Object.defineProperty(e,"OAuthCredential",{enumerable:!0,get:function(){return t.Q}}),Object.defineProperty(e,"OAuthProvider",{enumerable:!0,get:function(){return t._}}),Object.defineProperty(e,"OperationType",{enumerable:!0,get:function(){return t.O}}),Object.defineProperty(e,"PhoneAuthCredential",{enumerable:!0,get:function(){return t.U}}),Object.defineProperty(e,"PhoneAuthProvider",{enumerable:!0,get:function(){return t.P}}),Object.defineProperty(e,"PhoneMultiFactorGenerator",{enumerable:!0,get:function(){return t.n}}),Object.defineProperty(e,"ProviderId",{enumerable:!0,get:function(){return t.q}}),Object.defineProperty(e,"RecaptchaVerifier",{enumerable:!0,get:function(){return t.R}}),Object.defineProperty(e,"SAMLAuthProvider",{enumerable:!0,get:function(){return t.$}}),Object.defineProperty(e,"SignInMethod",{enumerable:!0,get:function(){return t.S}}),Object.defineProperty(e,"TotpMultiFactorGenerator",{enumerable:!0,get:function(){return t.T}}),Object.defineProperty(e,"TotpSecret",{enumerable:!0,get:function(){return t.o}}),Object.defineProperty(e,"TwitterAuthProvider",{enumerable:!0,get:function(){return t.a0}}),Object.defineProperty(e,"applyActionCode",{enumerable:!0,get:function(){return t.a8}}),Object.defineProperty(e,"beforeAuthStateChanged",{enumerable:!0,get:function(){return t.y}}),Object.defineProperty(e,"browserCookiePersistence",{enumerable:!0,get:function(){return t.a}}),Object.defineProperty(e,"browserLocalPersistence",{enumerable:!0,get:function(){return t.b}}),Object.defineProperty(e,"browserPopupRedirectResolver",{enumerable:!0,get:function(){return t.m}}),Object.defineProperty(e,"browserSessionPersistence",{enumerable:!0,get:function(){return t.c}}),Object.defineProperty(e,"checkActionCode",{enumerable:!0,get:function(){return t.a9}}),Object.defineProperty(e,"confirmPasswordReset",{enumerable:!0,get:function(){return t.a7}}),Object.defineProperty(e,"connectAuthEmulator",{enumerable:!0,get:function(){return t.L}}),Object.defineProperty(e,"createUserWithEmailAndPassword",{enumerable:!0,get:function(){return t.ab}}),Object.defineProperty(e,"debugErrorMap",{enumerable:!0,get:function(){return t.H}}),Object.defineProperty(e,"deleteUser",{enumerable:!0,get:function(){return t.G}}),Object.defineProperty(e,"fetchSignInMethodsForEmail",{enumerable:!0,get:function(){return t.ag}}),Object.defineProperty(e,"getAdditionalUserInfo",{enumerable:!0,get:function(){return t.ar}}),Object.defineProperty(e,"getAuth",{enumerable:!0,get:function(){return t.p}}),Object.defineProperty(e,"getIdToken",{enumerable:!0,get:function(){return t.ao}}),Object.defineProperty(e,"getIdTokenResult",{enumerable:!0,get:function(){return t.ap}}),Object.defineProperty(e,"getMultiFactorResolver",{enumerable:!0,get:function(){return t.at}}),Object.defineProperty(e,"getRedirectResult",{enumerable:!0,get:function(){return t.k}}),Object.defineProperty(e,"inMemoryPersistence",{enumerable:!0,get:function(){return t.V}}),Object.defineProperty(e,"indexedDBLocalPersistence",{enumerable:!0,get:function(){return t.i}}),Object.defineProperty(e,"initializeAuth",{enumerable:!0,get:function(){return t.K}}),Object.defineProperty(e,"initializeRecaptchaConfig",{enumerable:!0,get:function(){return t.v}}),Object.defineProperty(e,"isSignInWithEmailLink",{enumerable:!0,get:function(){return t.ae}}),Object.defineProperty(e,"linkWithCredential",{enumerable:!0,get:function(){return t.a3}}),Object.defineProperty(e,"linkWithPhoneNumber",{enumerable:!0,get:function(){return t.l}}),Object.defineProperty(e,"linkWithPopup",{enumerable:!0,get:function(){return t.e}}),Object.defineProperty(e,"linkWithRedirect",{enumerable:!0,get:function(){return t.h}}),Object.defineProperty(e,"multiFactor",{enumerable:!0,get:function(){return t.au}}),Object.defineProperty(e,"onAuthStateChanged",{enumerable:!0,get:function(){return t.z}}),Object.defineProperty(e,"onIdTokenChanged",{enumerable:!0,get:function(){return t.x}}),Object.defineProperty(e,"parseActionCodeURL",{enumerable:!0,get:function(){return t.ak}}),Object.defineProperty(e,"prodErrorMap",{enumerable:!0,get:function(){return t.I}}),Object.defineProperty(e,"reauthenticateWithCredential",{enumerable:!0,get:function(){return t.a4}}),Object.defineProperty(e,"reauthenticateWithPhoneNumber",{enumerable:!0,get:function(){return t.r}}),Object.defineProperty(e,"reauthenticateWithPopup",{enumerable:!0,get:function(){return t.f}}),Object.defineProperty(e,"reauthenticateWithRedirect",{enumerable:!0,get:function(){return t.j}}),Object.defineProperty(e,"reload",{enumerable:!0,get:function(){return t.as}}),Object.defineProperty(e,"revokeAccessToken",{enumerable:!0,get:function(){return t.E}}),Object.defineProperty(e,"sendEmailVerification",{enumerable:!0,get:function(){return t.ah}}),Object.defineProperty(e,"sendPasswordResetEmail",{enumerable:!0,get:function(){return t.a6}}),Object.defineProperty(e,"sendSignInLinkToEmail",{enumerable:!0,get:function(){return t.ad}}),Object.defineProperty(e,"setPersistence",{enumerable:!0,get:function(){return t.t}}),Object.defineProperty(e,"signInAnonymously",{enumerable:!0,get:function(){return t.a1}}),Object.defineProperty(e,"signInWithCredential",{enumerable:!0,get:function(){return t.a2}}),Object.defineProperty(e,"signInWithCustomToken",{enumerable:!0,get:function(){return t.a5}}),Object.defineProperty(e,"signInWithEmailAndPassword",{enumerable:!0,get:function(){return t.ac}}),Object.defineProperty(e,"signInWithEmailLink",{enumerable:!0,get:function(){return t.af}}),Object.defineProperty(e,"signInWithPhoneNumber",{enumerable:!0,get:function(){return t.s}}),Object.defineProperty(e,"signInWithPopup",{enumerable:!0,get:function(){return t.d}}),Object.defineProperty(e,"signInWithRedirect",{enumerable:!0,get:function(){return t.g}}),Object.defineProperty(e,"signOut",{enumerable:!0,get:function(){return t.D}}),Object.defineProperty(e,"unlink",{enumerable:!0,get:function(){return t.aq}}),Object.defineProperty(e,"updateCurrentUser",{enumerable:!0,get:function(){return t.C}}),Object.defineProperty(e,"updateEmail",{enumerable:!0,get:function(){return t.am}}),Object.defineProperty(e,"updatePassword",{enumerable:!0,get:function(){return t.an}}),Object.defineProperty(e,"updatePhoneNumber",{enumerable:!0,get:function(){return t.u}}),Object.defineProperty(e,"updateProfile",{enumerable:!0,get:function(){return t.al}}),Object.defineProperty(e,"useDeviceLanguage",{enumerable:!0,get:function(){return t.B}}),Object.defineProperty(e,"validatePassword",{enumerable:!0,get:function(){return t.w}}),Object.defineProperty(e,"verifyBeforeUpdateEmail",{enumerable:!0,get:function(){return t.ai}}),Object.defineProperty(e,"verifyPasswordResetCode",{enumerable:!0,get:function(){return t.aa}});var t=r(d[0]);r(d[1]),r(d[2]),r(d[3]),r(d[4])},1376,[1377,1368,1370,1372,1369]);
__d(function(e,t,n,r,i,s,o){"use strict";const a=["providerId"],c=["uid","auth","stsTokenManager"],u=["providerId","signInMethod"];Object.defineProperty(s,'__esModule',{value:!0}),Object.defineProperty(s,"$",{enumerable:!0,get:function(){return nn}}),Object.defineProperty(s,"A",{enumerable:!0,get:function(){return T}}),Object.defineProperty(s,"B",{enumerable:!0,get:function(){return or}}),Object.defineProperty(s,"C",{enumerable:!0,get:function(){return ar}}),Object.defineProperty(s,"D",{enumerable:!0,get:function(){return cr}}),Object.defineProperty(s,"E",{enumerable:!0,get:function(){return ur}}),Object.defineProperty(s,"F",{enumerable:!0,get:function(){return I}}),Object.defineProperty(s,"G",{enumerable:!0,get:function(){return dr}}),Object.defineProperty(s,"H",{enumerable:!0,get:function(){return w}}),Object.defineProperty(s,"I",{enumerable:!0,get:function(){return b}}),Object.defineProperty(s,"J",{enumerable:!0,get:function(){return A}}),Object.defineProperty(s,"K",{enumerable:!0,get:function(){return mt}}),Object.defineProperty(s,"L",{enumerable:!0,get:function(){return It}}),Object.defineProperty(s,"M",{enumerable:!0,get:function(){return Et}}),Object.defineProperty(s,"N",{enumerable:!0,get:function(){return Mt}}),Object.defineProperty(s,"O",{enumerable:!0,get:function(){return v}}),Object.defineProperty(s,"P",{enumerable:!0,get:function(){return mi}}),Object.defineProperty(s,"Q",{enumerable:!0,get:function(){return jt}}),Object.defineProperty(s,"R",{enumerable:!0,get:function(){return oi}}),Object.defineProperty(s,"S",{enumerable:!0,get:function(){return y}}),Object.defineProperty(s,"T",{enumerable:!0,get:function(){return bs}}),Object.defineProperty(s,"U",{enumerable:!0,get:function(){return Wt}}),Object.defineProperty(s,"V",{enumerable:!0,get:function(){return De}}),Object.defineProperty(s,"W",{enumerable:!0,get:function(){return Bt}}),Object.defineProperty(s,"X",{enumerable:!0,get:function(){return Qt}}),Object.defineProperty(s,"Y",{enumerable:!0,get:function(){return Zt}}),Object.defineProperty(s,"Z",{enumerable:!0,get:function(){return en}}),Object.defineProperty(s,"_",{enumerable:!0,get:function(){return Xt}}),Object.defineProperty(s,"a",{enumerable:!0,get:function(){return Sr}}),Object.defineProperty(s,"a0",{enumerable:!0,get:function(){return rn}}),Object.defineProperty(s,"a1",{enumerable:!0,get:function(){return cn}}),Object.defineProperty(s,"a2",{enumerable:!0,get:function(){return In}}),Object.defineProperty(s,"a3",{enumerable:!0,get:function(){return _n}}),Object.defineProperty(s,"a4",{enumerable:!0,get:function(){return yn}}),Object.defineProperty(s,"a5",{enumerable:!0,get:function(){return Tn}}),Object.defineProperty(s,"a6",{enumerable:!0,get:function(){return Sn}}),Object.defineProperty(s,"a7",{enumerable:!0,get:function(){return On}}),Object.defineProperty(s,"a8",{enumerable:!0,get:function(){return kn}}),Object.defineProperty(s,"a9",{enumerable:!0,get:function(){return Rn}}),Object.defineProperty(s,"aA",{enumerable:!0,get:function(){return Ji}}),Object.defineProperty(s,"aB",{enumerable:!0,get:function(){return Ge}}),Object.defineProperty(s,"aC",{enumerable:!0,get:function(){return N}}),Object.defineProperty(s,"aD",{enumerable:!0,get:function(){return U}}),Object.defineProperty(s,"aE",{enumerable:!0,get:function(){return Gi}}),Object.defineProperty(s,"aF",{enumerable:!0,get:function(){return Ne}}),Object.defineProperty(s,"aG",{enumerable:!0,get:function(){return Le}}),Object.defineProperty(s,"aH",{enumerable:!0,get:function(){return Wi}}),Object.defineProperty(s,"aI",{enumerable:!0,get:function(){return Di}}),Object.defineProperty(s,"aJ",{enumerable:!0,get:function(){return Ci}}),Object.defineProperty(s,"aK",{enumerable:!0,get:function(){return Ze}}),Object.defineProperty(s,"aL",{enumerable:!0,get:function(){return ke}}),Object.defineProperty(s,"aM",{enumerable:!0,get:function(){return Qe}}),Object.defineProperty(s,"aN",{enumerable:!0,get:function(){return Be}}),Object.defineProperty(s,"aO",{enumerable:!0,get:function(){return Cr}}),Object.defineProperty(s,"aP",{enumerable:!0,get:function(){return ls}}),Object.defineProperty(s,"aQ",{enumerable:!0,get:function(){return G}}),Object.defineProperty(s,"aR",{enumerable:!0,get:function(){return tn}}),Object.defineProperty(s,"aa",{enumerable:!0,get:function(){return Nn}}),Object.defineProperty(s,"ab",{enumerable:!0,get:function(){return Cn}}),Object.defineProperty(s,"ac",{enumerable:!0,get:function(){return Dn}}),Object.defineProperty(s,"ad",{enumerable:!0,get:function(){return Ln}}),Object.defineProperty(s,"ae",{enumerable:!0,get:function(){return Mn}}),Object.defineProperty(s,"af",{enumerable:!0,get:function(){return Un}}),Object.defineProperty(s,"ag",{enumerable:!0,get:function(){return Fn}}),Object.defineProperty(s,"ah",{enumerable:!0,get:function(){return Vn}}),Object.defineProperty(s,"ai",{enumerable:!0,get:function(){return xn}}),Object.defineProperty(s,"aj",{enumerable:!0,get:function(){return Kt}}),Object.defineProperty(s,"ak",{enumerable:!0,get:function(){return $t}}),Object.defineProperty(s,"al",{enumerable:!0,get:function(){return qn}}),Object.defineProperty(s,"am",{enumerable:!0,get:function(){return Wn}}),Object.defineProperty(s,"an",{enumerable:!0,get:function(){return zn}}),Object.defineProperty(s,"ao",{enumerable:!0,get:function(){return he}}),Object.defineProperty(s,"ap",{enumerable:!0,get:function(){return pe}}),Object.defineProperty(s,"aq",{enumerable:!0,get:function(){return hn}}),Object.defineProperty(s,"ar",{enumerable:!0,get:function(){return Zn}}),Object.defineProperty(s,"as",{enumerable:!0,get:function(){return Ee}}),Object.defineProperty(s,"at",{enumerable:!0,get:function(){return pr}}),Object.defineProperty(s,"au",{enumerable:!0,get:function(){return yr}}),Object.defineProperty(s,"av",{enumerable:!0,get:function(){return F}}),Object.defineProperty(s,"aw",{enumerable:!0,get:function(){return ze}}),Object.defineProperty(s,"ax",{enumerable:!0,get:function(){return He}}),Object.defineProperty(s,"ay",{enumerable:!0,get:function(){return R}}),Object.defineProperty(s,"az",{enumerable:!0,get:function(){return Is}}),Object.defineProperty(s,"b",{enumerable:!0,get:function(){return wr}}),Object.defineProperty(s,"c",{enumerable:!0,get:function(){return kr}}),Object.defineProperty(s,"d",{enumerable:!0,get:function(){return wi}}),Object.defineProperty(s,"e",{enumerable:!0,get:function(){return Pi}}),Object.defineProperty(s,"f",{enumerable:!0,get:function(){return bi}}),Object.defineProperty(s,"g",{enumerable:!0,get:function(){return Ui}}),Object.defineProperty(s,"h",{enumerable:!0,get:function(){return xi}}),Object.defineProperty(s,"i",{enumerable:!0,get:function(){return Jr}}),Object.defineProperty(s,"j",{enumerable:!0,get:function(){return Fi}}),Object.defineProperty(s,"k",{enumerable:!0,get:function(){return qi}}),Object.defineProperty(s,"l",{enumerable:!0,get:function(){return di}}),Object.defineProperty(s,"m",{enumerable:!0,get:function(){return vs}}),Object.defineProperty(s,"n",{enumerable:!0,get:function(){return ws}}),Object.defineProperty(s,"o",{enumerable:!0,get:function(){return As}}),Object.defineProperty(s,"p",{enumerable:!0,get:function(){return Ms}}),Object.defineProperty(s,"q",{enumerable:!0,get:function(){return _}}),Object.defineProperty(s,"r",{enumerable:!0,get:function(){return li}}),Object.defineProperty(s,"s",{enumerable:!0,get:function(){return ui}}),Object.defineProperty(s,"t",{enumerable:!0,get:function(){return er}}),Object.defineProperty(s,"u",{enumerable:!0,get:function(){return pi}}),Object.defineProperty(s,"v",{enumerable:!0,get:function(){return tr}}),Object.defineProperty(s,"w",{enumerable:!0,get:function(){return nr}}),Object.defineProperty(s,"x",{enumerable:!0,get:function(){return rr}}),Object.defineProperty(s,"y",{enumerable:!0,get:function(){return ir}}),Object.defineProperty(s,"z",{enumerable:!0,get:function(){return sr}});var d,l=t(o[0]),h=(d=l)&&d.__esModule?d:{default:d},p=t(o[1]),f=t(o[2]),m=t(o[3]),g=t(o[4]);
/**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
const I={PHONE:'phone',TOTP:'totp'},_={FACEBOOK:'facebook.com',GITHUB:'github.com',GOOGLE:'google.com',PASSWORD:'password',PHONE:'phone',TWITTER:'twitter.com'},y={EMAIL_LINK:'emailLink',EMAIL_PASSWORD:'password',FACEBOOK:'facebook.com',GITHUB:'github.com',GOOGLE:'google.com',PHONE:'phone',TWITTER:'twitter.com'},v={LINK:'link',REAUTHENTICATE:'reauthenticate',SIGN_IN:'signIn'},T={EMAIL_SIGNIN:'EMAIL_SIGNIN',PASSWORD_RESET:'PASSWORD_RESET',RECOVER_EMAIL:'RECOVER_EMAIL',REVERT_SECOND_FACTOR_ADDITION:'REVERT_SECOND_FACTOR_ADDITION',VERIFY_AND_CHANGE_EMAIL:'VERIFY_AND_CHANGE_EMAIL',VERIFY_EMAIL:'VERIFY_EMAIL'};function E(){return{"dependent-sdk-initialized-before-auth":"Another Firebase SDK was initialized and is trying to use Auth before Auth is initialized. Please be sure to call `initializeAuth` or `getAuth` before starting any other Firebase SDK."}}const w=
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
function(){return{"admin-restricted-operation":'This operation is restricted to administrators only.',"argument-error":'',"app-not-authorized":"This app, identified by the domain where it's hosted, is not authorized to use Firebase Authentication with the provided API key. Review your key configuration in the Google API console.","app-not-installed":"The requested mobile application corresponding to the identifier (Android package name or iOS bundle ID) provided is not installed on this device.","captcha-check-failed":"The reCAPTCHA response token provided is either invalid, expired, already used or the domain associated with it does not match the list of whitelisted domains.","code-expired":"The SMS code has expired. Please re-send the verification code to try again.","cordova-not-ready":'Cordova framework is not ready.',"cors-unsupported":'This browser is not supported.',"credential-already-in-use":'This credential is already associated with a different user account.',"custom-token-mismatch":'The custom token corresponds to a different audience.',"requires-recent-login":"This operation is sensitive and requires recent authentication. Log in again before retrying this request.","dependent-sdk-initialized-before-auth":"Another Firebase SDK was initialized and is trying to use Auth before Auth is initialized. Please be sure to call `initializeAuth` or `getAuth` before starting any other Firebase SDK.","dynamic-link-not-activated":"Please activate Dynamic Links in the Firebase Console and agree to the terms and conditions.","email-change-needs-verification":'Multi-factor users must always have a verified email.',"email-already-in-use":'The email address is already in use by another account.',"emulator-config-failed":"Auth instance has already been used to make a network call. Auth can no longer be configured to use the emulator. Try calling \"connectAuthEmulator()\" sooner.","expired-action-code":'The action code has expired.',"cancelled-popup-request":'This operation has been cancelled due to another conflicting popup being opened.',"internal-error":'An internal AuthError has occurred.',"invalid-app-credential":"The phone verification request contains an invalid application verifier. The reCAPTCHA token response is either invalid or expired.","invalid-app-id":'The mobile app identifier is not registered for the current project.',"invalid-user-token":"This user's credential isn't valid for this project. This can happen if the user's token has been tampered with, or if the user isn't for the project associated with this API key.","invalid-auth-event":'An internal AuthError has occurred.',"invalid-verification-code":"The SMS verification code used to create the phone auth credential is invalid. Please resend the verification code sms and be sure to use the verification code provided by the user.","invalid-continue-uri":'The continue URL provided in the request is invalid.',"invalid-cordova-configuration":"The following Cordova plugins must be installed to enable OAuth sign-in: cordova-plugin-buildinfo, cordova-universal-links-plugin, cordova-plugin-browsertab, cordova-plugin-inappbrowser and cordova-plugin-customurlscheme.","invalid-custom-token":'The custom token format is incorrect. Please check the documentation.',"invalid-dynamic-link-domain":'The provided dynamic link domain is not configured or authorized for the current project.',"invalid-email":'The email address is badly formatted.',"invalid-emulator-scheme":'Emulator URL must start with a valid scheme (http:// or https://).',"invalid-api-key":'Your API key is invalid, please check you have copied it correctly.',"invalid-cert-hash":'The SHA-1 certificate hash provided is invalid.',"invalid-credential":'The supplied auth credential is incorrect, malformed or has expired.',"invalid-message-payload":"The email template corresponding to this action contains invalid characters in its message. Please fix by going to the Auth email templates section in the Firebase Console.","invalid-multi-factor-session":'The request does not contain a valid proof of first factor successful sign-in.',"invalid-oauth-provider":"EmailAuthProvider is not supported for this operation. This operation only supports OAuth providers.","invalid-oauth-client-id":"The OAuth client ID provided is either invalid or does not match the specified API key.","unauthorized-domain":"This domain is not authorized for OAuth operations for your Firebase project. Edit the list of authorized domains from the Firebase console.","invalid-action-code":"The action code is invalid. This can happen if the code is malformed, expired, or has already been used.","wrong-password":'The password is invalid or the user does not have a password.',"invalid-persistence-type":'The specified persistence type is invalid. It can only be local, session or none.',"invalid-phone-number":"The format of the phone number provided is incorrect. Please enter the phone number in a format that can be parsed into E.164 format. E.164 phone numbers are written in the format [+][country code][subscriber number including area code].","invalid-provider-id":'The specified provider ID is invalid.',"invalid-recipient-email":"The email corresponding to this action failed to send as the provided recipient email address is invalid.","invalid-sender":"The email template corresponding to this action contains an invalid sender email or name. Please fix by going to the Auth email templates section in the Firebase Console.","invalid-verification-id":'The verification ID used to create the phone auth credential is invalid.',"invalid-tenant-id":"The Auth instance's tenant ID is invalid.","login-blocked":'Login blocked by user-provided method: {$originalMessage}',"missing-android-pkg-name":'An Android Package Name must be provided if the Android App is required to be installed.',"auth-domain-config-required":"Be sure to include authDomain when calling firebase.initializeApp(), by following the instructions in the Firebase console.","missing-app-credential":"The phone verification request is missing an application verifier assertion. A reCAPTCHA response token needs to be provided.","missing-verification-code":'The phone auth credential was created with an empty SMS verification code.',"missing-continue-uri":'A continue URL must be provided in the request.',"missing-iframe-start":'An internal AuthError has occurred.',"missing-ios-bundle-id":'An iOS Bundle ID must be provided if an App Store ID is provided.',"missing-or-invalid-nonce":"The request does not contain a valid nonce. This can occur if the SHA-256 hash of the provided raw nonce does not match the hashed nonce in the ID token payload.","missing-password":'A non-empty password must be provided',"missing-multi-factor-info":'No second factor identifier is provided.',"missing-multi-factor-session":'The request is missing proof of first factor successful sign-in.',"missing-phone-number":'To send verification codes, provide a phone number for the recipient.',"missing-verification-id":'The phone auth credential was created with an empty verification ID.',"app-deleted":'This instance of FirebaseApp has been deleted.',"multi-factor-info-not-found":'The user does not have a second factor matching the identifier provided.',"multi-factor-auth-required":'Proof of ownership of a second factor is required to complete sign-in.',"account-exists-with-different-credential":"An account already exists with the same email address but different sign-in credentials. Sign in using a provider associated with this email address.","network-request-failed":'A network AuthError (such as timeout, interrupted connection or unreachable host) has occurred.',"no-auth-event":'An internal AuthError has occurred.',"no-such-provider":'User was not linked to an account with the given provider.',"null-user":"A null user object was provided as the argument for an operation which requires a non-null user object.","operation-not-allowed":"The given sign-in provider is disabled for this Firebase project. Enable it in the Firebase console, under the sign-in method tab of the Auth section.","operation-not-supported-in-this-environment":"This operation is not supported in the environment this application is running on. \"location.protocol\" must be http, https or chrome-extension and web storage must be enabled.","popup-blocked":'Unable to establish a connection with the popup. It may have been blocked by the browser.',"popup-closed-by-user":'The popup has been closed by the user before finalizing the operation.',"provider-already-linked":'User can only be linked to one identity for the given provider.',"quota-exceeded":"The project's quota for this operation has been exceeded.","redirect-cancelled-by-user":'The redirect operation has been cancelled by the user before finalizing.',"redirect-operation-pending":'A redirect sign-in operation is already pending.',"rejected-credential":'The request contains malformed or mismatching credentials.',"second-factor-already-in-use":'The second factor is already enrolled on this account.',"maximum-second-factor-count-exceeded":'The maximum allowed number of second factors on a user has been exceeded.',"tenant-id-mismatch":"The provided tenant ID does not match the Auth instance's tenant ID",timeout:'The operation has timed out.',"user-token-expired":"The user's credential is no longer valid. The user must sign in again.","too-many-requests":"We have blocked all requests from this device due to unusual activity. Try again later.","unauthorized-continue-uri":"The domain of the continue URL is not whitelisted.  Please whitelist the domain in the Firebase console.","unsupported-first-factor":'Enrolling a second factor or signing in with a multi-factor account requires sign-in with a supported first factor.',"unsupported-persistence-type":'The current environment does not support the specified persistence type.',"unsupported-tenant-operation":'This operation is not supported in a multi-tenant context.',"unverified-email":'The operation requires a verified email.',"user-cancelled":'The user did not grant your application the permissions it requested.',"user-not-found":"There is no user record corresponding to this identifier. The user may have been deleted.","user-disabled":'The user account has been disabled by an administrator.',"user-mismatch":'The supplied credentials do not correspond to the previously signed in user.',"user-signed-out":'',"weak-password":'The password must be 6 characters long or more.',"web-storage-unsupported":'This browser is not supported or 3rd party cookies and data may be disabled.',"already-initialized":"initializeAuth() has already been called with different options. To avoid this error, call initializeAuth() with the same options as when it was originally called, or call getAuth() to return the already initialized instance.","missing-recaptcha-token":'The reCAPTCHA token is missing when sending request to the backend.',"invalid-recaptcha-token":'The reCAPTCHA token is invalid when sending request to the backend.',"invalid-recaptcha-action":'The reCAPTCHA action is invalid when sending request to the backend.',"recaptcha-not-enabled":'reCAPTCHA Enterprise integration is not enabled for this project.',"missing-client-type":'The reCAPTCHA client type is missing when sending request to the backend.',"missing-recaptcha-version":'The reCAPTCHA version is missing when sending request to the backend.',"invalid-req-type":'Invalid request parameters.',"invalid-recaptcha-version":'The reCAPTCHA version is invalid when sending request to the backend.',"unsupported-password-policy-schema-version":'The password policy received from the backend uses a schema version that is not supported by this version of the Firebase SDK.',"password-does-not-meet-requirements":'The password does not meet the requirements.',"invalid-hosting-link-domain":"The provided Hosting link domain is not configured in Firebase Hosting or is not owned by the current project. This cannot be a default Hosting domain (`web.app` or `firebaseapp.com`)."}},b=E,P=new f.ErrorFactory('auth','Firebase',{"dependent-sdk-initialized-before-auth":"Another Firebase SDK was initialized and is trying to use Auth before Auth is initialized. Please be sure to call `initializeAuth` or `getAuth` before starting any other Firebase SDK."}),A={ADMIN_ONLY_OPERATION:'auth/admin-restricted-operation',ARGUMENT_ERROR:'auth/argument-error',APP_NOT_AUTHORIZED:'auth/app-not-authorized',APP_NOT_INSTALLED:'auth/app-not-installed',CAPTCHA_CHECK_FAILED:'auth/captcha-check-failed',CODE_EXPIRED:'auth/code-expired',CORDOVA_NOT_READY:'auth/cordova-not-ready',CORS_UNSUPPORTED:'auth/cors-unsupported',CREDENTIAL_ALREADY_IN_USE:'auth/credential-already-in-use',CREDENTIAL_MISMATCH:'auth/custom-token-mismatch',CREDENTIAL_TOO_OLD_LOGIN_AGAIN:'auth/requires-recent-login',DEPENDENT_SDK_INIT_BEFORE_AUTH:'auth/dependent-sdk-initialized-before-auth',DYNAMIC_LINK_NOT_ACTIVATED:'auth/dynamic-link-not-activated',EMAIL_CHANGE_NEEDS_VERIFICATION:'auth/email-change-needs-verification',EMAIL_EXISTS:'auth/email-already-in-use',EMULATOR_CONFIG_FAILED:'auth/emulator-config-failed',EXPIRED_OOB_CODE:'auth/expired-action-code',EXPIRED_POPUP_REQUEST:'auth/cancelled-popup-request',INTERNAL_ERROR:'auth/internal-error',INVALID_API_KEY:'auth/invalid-api-key',INVALID_APP_CREDENTIAL:'auth/invalid-app-credential',INVALID_APP_ID:'auth/invalid-app-id',INVALID_AUTH:'auth/invalid-user-token',INVALID_AUTH_EVENT:'auth/invalid-auth-event',INVALID_CERT_HASH:'auth/invalid-cert-hash',INVALID_CODE:'auth/invalid-verification-code',INVALID_CONTINUE_URI:'auth/invalid-continue-uri',INVALID_CORDOVA_CONFIGURATION:'auth/invalid-cordova-configuration',INVALID_CUSTOM_TOKEN:'auth/invalid-custom-token',INVALID_DYNAMIC_LINK_DOMAIN:'auth/invalid-dynamic-link-domain',INVALID_EMAIL:'auth/invalid-email',INVALID_EMULATOR_SCHEME:'auth/invalid-emulator-scheme',INVALID_IDP_RESPONSE:'auth/invalid-credential',INVALID_LOGIN_CREDENTIALS:'auth/invalid-credential',INVALID_MESSAGE_PAYLOAD:'auth/invalid-message-payload',INVALID_MFA_SESSION:'auth/invalid-multi-factor-session',INVALID_OAUTH_CLIENT_ID:'auth/invalid-oauth-client-id',INVALID_OAUTH_PROVIDER:'auth/invalid-oauth-provider',INVALID_OOB_CODE:'auth/invalid-action-code',INVALID_ORIGIN:'auth/unauthorized-domain',INVALID_PASSWORD:'auth/wrong-password',INVALID_PERSISTENCE:'auth/invalid-persistence-type',INVALID_PHONE_NUMBER:'auth/invalid-phone-number',INVALID_PROVIDER_ID:'auth/invalid-provider-id',INVALID_RECIPIENT_EMAIL:'auth/invalid-recipient-email',INVALID_SENDER:'auth/invalid-sender',INVALID_SESSION_INFO:'auth/invalid-verification-id',INVALID_TENANT_ID:'auth/invalid-tenant-id',MFA_INFO_NOT_FOUND:'auth/multi-factor-info-not-found',MFA_REQUIRED:'auth/multi-factor-auth-required',MISSING_ANDROID_PACKAGE_NAME:'auth/missing-android-pkg-name',MISSING_APP_CREDENTIAL:'auth/missing-app-credential',MISSING_AUTH_DOMAIN:'auth/auth-domain-config-required',MISSING_CODE:'auth/missing-verification-code',MISSING_CONTINUE_URI:'auth/missing-continue-uri',MISSING_IFRAME_START:'auth/missing-iframe-start',MISSING_IOS_BUNDLE_ID:'auth/missing-ios-bundle-id',MISSING_OR_INVALID_NONCE:'auth/missing-or-invalid-nonce',MISSING_MFA_INFO:'auth/missing-multi-factor-info',MISSING_MFA_SESSION:'auth/missing-multi-factor-session',MISSING_PHONE_NUMBER:'auth/missing-phone-number',MISSING_PASSWORD:'auth/missing-password',MISSING_SESSION_INFO:'auth/missing-verification-id',MODULE_DESTROYED:'auth/app-deleted',NEED_CONFIRMATION:'auth/account-exists-with-different-credential',NETWORK_REQUEST_FAILED:'auth/network-request-failed',NULL_USER:'auth/null-user',NO_AUTH_EVENT:'auth/no-auth-event',NO_SUCH_PROVIDER:'auth/no-such-provider',OPERATION_NOT_ALLOWED:'auth/operation-not-allowed',OPERATION_NOT_SUPPORTED:'auth/operation-not-supported-in-this-environment',POPUP_BLOCKED:'auth/popup-blocked',POPUP_CLOSED_BY_USER:'auth/popup-closed-by-user',PROVIDER_ALREADY_LINKED:'auth/provider-already-linked',QUOTA_EXCEEDED:'auth/quota-exceeded',REDIRECT_CANCELLED_BY_USER:'auth/redirect-cancelled-by-user',REDIRECT_OPERATION_PENDING:'auth/redirect-operation-pending',REJECTED_CREDENTIAL:'auth/rejected-credential',SECOND_FACTOR_ALREADY_ENROLLED:'auth/second-factor-already-in-use',SECOND_FACTOR_LIMIT_EXCEEDED:'auth/maximum-second-factor-count-exceeded',TENANT_ID_MISMATCH:'auth/tenant-id-mismatch',TIMEOUT:'auth/timeout',TOKEN_EXPIRED:'auth/user-token-expired',TOO_MANY_ATTEMPTS_TRY_LATER:'auth/too-many-requests',UNAUTHORIZED_DOMAIN:'auth/unauthorized-continue-uri',UNSUPPORTED_FIRST_FACTOR:'auth/unsupported-first-factor',UNSUPPORTED_PERSISTENCE:'auth/unsupported-persistence-type',UNSUPPORTED_TENANT_OPERATION:'auth/unsupported-tenant-operation',UNVERIFIED_EMAIL:'auth/unverified-email',USER_CANCELLED:'auth/user-cancelled',USER_DELETED:'auth/user-not-found',USER_DISABLED:'auth/user-disabled',USER_MISMATCH:'auth/user-mismatch',USER_SIGNED_OUT:'auth/user-signed-out',WEAK_PASSWORD:'auth/weak-password',WEB_STORAGE_UNSUPPORTED:'auth/web-storage-unsupported',ALREADY_INITIALIZED:'auth/already-initialized',RECAPTCHA_NOT_ENABLED:'auth/recaptcha-not-enabled',MISSING_RECAPTCHA_TOKEN:'auth/missing-recaptcha-token',INVALID_RECAPTCHA_TOKEN:'auth/invalid-recaptcha-token',INVALID_RECAPTCHA_ACTION:'auth/invalid-recaptcha-action',MISSING_CLIENT_TYPE:'auth/missing-client-type',MISSING_RECAPTCHA_VERSION:'auth/missing-recaptcha-version',INVALID_RECAPTCHA_VERSION:'auth/invalid-recaptcha-version',INVALID_REQ_TYPE:'auth/invalid-req-type',INVALID_HOSTING_LINK_DOMAIN:'auth/invalid-hosting-link-domain'},S=new m.Logger('@firebase/auth');function O(e,...t){S.logLevel<=m.LogLevel.WARN&&S.warn(`Auth (${p.SDK_VERSION}): ${e}`,...t)}function k(e,...t){S.logLevel<=m.LogLevel.ERROR&&S.error(`Auth (${p.SDK_VERSION}): ${e}`,...t)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function R(e,...t){throw M(e,...t)}function N(e,...t){return M(e,...t)}function C(e,t,n){const r=Object.assign({},b(),{[t]:n});return new f.ErrorFactory('auth','Firebase',r).create(t,{appName:e.name})}function D(e){return C(e,"operation-not-supported-in-this-environment",'Operations that alter the current user are not supported in conjunction with FirebaseServerApp')}function L(e,t,n){if(!(t instanceof n))throw n.name!==t.constructor.name&&R(e,"argument-error"),C(e,"argument-error",`Type of ${t.constructor.name} does not match expected instance.Did you pass a reference from a different Auth SDK?`)}function M(e,...t){if('string'!=typeof e){const n=t[0],r=[...t.slice(1)];return r[0]&&(r[0].appName=e.name),e._errorFactory.create(n,...r)}return P.create(e,...t)}function U(e,t,...n){if(!e)throw M(t,...n)}function j(e){const t="INTERNAL ASSERTION FAILED: "+e;throw k(t),new Error(t)}function F(e,t){e||j(t)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function V(){return'undefined'!=typeof self&&self.location?.href||''}function x(){return'http:'===H()||'https:'===H()}function H(){return'undefined'!=typeof self&&self.location?.protocol||null}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function q(){if('undefined'==typeof navigator)return null;const e=navigator;return e.languages&&e.languages[0]||e.language||null}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class W{constructor(e,t){this.shortDelay=e,this.longDelay=t,F(t>e,'Short delay should be less than long delay!'),this.isMobile=(0,f.isMobileCordova)()||(0,f.isReactNative)()}get(){return'undefined'!=typeof navigator&&navigator&&'onLine'in navigator&&'boolean'==typeof navigator.onLine&&(x()||(0,f.isBrowserExtension)()||'connection'in navigator)&&!navigator.onLine?Math.min(5e3,this.shortDelay):this.isMobile?this.longDelay:this.shortDelay}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function z(e,t){F(e.emulator,'Emulator should always be set here');const{url:n}=e.emulator;return t?`${n}${t.startsWith('/')?t.slice(1):t}`:n}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class G{static initialize(e,t,n){this.fetchImpl=e,t&&(this.headersImpl=t),n&&(this.responseImpl=n)}static fetch(){return this.fetchImpl?this.fetchImpl:'undefined'!=typeof self&&'fetch'in self?self.fetch:'undefined'!=typeof globalThis&&globalThis.fetch?globalThis.fetch:'undefined'!=typeof fetch?fetch:void j('Could not find fetch implementation, make sure you call FetchProvider.initialize() with an appropriate polyfill')}static headers(){return this.headersImpl?this.headersImpl:'undefined'!=typeof self&&'Headers'in self?self.Headers:'undefined'!=typeof globalThis&&globalThis.Headers?globalThis.Headers:'undefined'!=typeof Headers?Headers:void j('Could not find Headers implementation, make sure you call FetchProvider.initialize() with an appropriate polyfill')}static response(){return this.responseImpl?this.responseImpl:'undefined'!=typeof self&&'Response'in self?self.Response:'undefined'!=typeof globalThis&&globalThis.Response?globalThis.Response:'undefined'!=typeof Response?Response:void j('Could not find Response implementation, make sure you call FetchProvider.initialize() with an appropriate polyfill')}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const K={CREDENTIAL_MISMATCH:"custom-token-mismatch",MISSING_CUSTOM_TOKEN:"internal-error",INVALID_IDENTIFIER:"invalid-email",MISSING_CONTINUE_URI:"internal-error",INVALID_PASSWORD:"wrong-password",MISSING_PASSWORD:"missing-password",INVALID_LOGIN_CREDENTIALS:"invalid-credential",EMAIL_EXISTS:"email-already-in-use",PASSWORD_LOGIN_DISABLED:"operation-not-allowed",INVALID_IDP_RESPONSE:"invalid-credential",INVALID_PENDING_TOKEN:"invalid-credential",FEDERATED_USER_ID_ALREADY_LINKED:"credential-already-in-use",MISSING_REQ_TYPE:"internal-error",EMAIL_NOT_FOUND:"user-not-found",RESET_PASSWORD_EXCEED_LIMIT:"too-many-requests",EXPIRED_OOB_CODE:"expired-action-code",INVALID_OOB_CODE:"invalid-action-code",MISSING_OOB_CODE:"internal-error",CREDENTIAL_TOO_OLD_LOGIN_AGAIN:"requires-recent-login",INVALID_ID_TOKEN:"invalid-user-token",TOKEN_EXPIRED:"user-token-expired",USER_NOT_FOUND:"user-token-expired",TOO_MANY_ATTEMPTS_TRY_LATER:"too-many-requests",PASSWORD_DOES_NOT_MEET_REQUIREMENTS:"password-does-not-meet-requirements",INVALID_CODE:"invalid-verification-code",INVALID_SESSION_INFO:"invalid-verification-id",INVALID_TEMPORARY_PROOF:"invalid-credential",MISSING_SESSION_INFO:"missing-verification-id",SESSION_EXPIRED:"code-expired",MISSING_ANDROID_PACKAGE_NAME:"missing-android-pkg-name",UNAUTHORIZED_DOMAIN:"unauthorized-continue-uri",INVALID_OAUTH_CLIENT_ID:"invalid-oauth-client-id",ADMIN_ONLY_OPERATION:"admin-restricted-operation",INVALID_MFA_PENDING_CREDENTIAL:"invalid-multi-factor-session",MFA_ENROLLMENT_NOT_FOUND:"multi-factor-info-not-found",MISSING_MFA_ENROLLMENT_ID:"missing-multi-factor-info",MISSING_MFA_PENDING_CREDENTIAL:"missing-multi-factor-session",SECOND_FACTOR_EXISTS:"second-factor-already-in-use",SECOND_FACTOR_LIMIT_EXCEEDED:"maximum-second-factor-count-exceeded",BLOCKING_FUNCTION_ERROR_RESPONSE:"internal-error",RECAPTCHA_NOT_ENABLED:"recaptcha-not-enabled",MISSING_RECAPTCHA_TOKEN:"missing-recaptcha-token",INVALID_RECAPTCHA_TOKEN:"invalid-recaptcha-token",INVALID_RECAPTCHA_ACTION:"invalid-recaptcha-action",MISSING_CLIENT_TYPE:"missing-client-type",MISSING_RECAPTCHA_VERSION:"missing-recaptcha-version",INVALID_RECAPTCHA_VERSION:"invalid-recaptcha-version",INVALID_REQ_TYPE:"invalid-req-type"},$=["/v1/accounts:signInWithCustomToken","/v1/accounts:signInWithEmailLink","/v1/accounts:signInWithIdp","/v1/accounts:signInWithPassword","/v1/accounts:signInWithPhoneNumber","/v1/token"],B=new W(3e4,6e4);
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function J(e,t){return e.tenantId&&!t.tenantId?Object.assign({},t,{tenantId:e.tenantId}):t}async function Y(e,t,n,r,i={}){return X(e,i,async()=>{let i={},s={};r&&("GET"===t?s=r:i={body:JSON.stringify(r)});const o=(0,f.querystring)(Object.assign({key:e.config.apiKey},s)).slice(1),a=await e._getAdditionalHeaders();a["Content-Type"]='application/json',e.languageCode&&(a["X-Firebase-Locale"]=e.languageCode);const c=Object.assign({method:t,headers:a},i);return(0,f.isCloudflareWorker)()||(c.referrerPolicy='no-referrer'),e.emulatorConfig&&(0,f.isCloudWorkstation)(e.emulatorConfig.host)&&(c.credentials='include'),G.fetch()(await Z(e,e.config.apiHost,n,o),c)})}async function X(e,t,n){e._canInitEmulator=!1;const r=Object.assign({},K,t);try{const t=new te(e),i=await Promise.race([n(),t.promise]);t.clearNetworkTimeout();const s=await i.json();if('needConfirmation'in s)throw ne(e,"account-exists-with-different-credential",s);if(i.ok&&!('errorMessage'in s))return s;{const t=i.ok?s.errorMessage:s.error.message,[n,o]=t.split(' : ');if("FEDERATED_USER_ID_ALREADY_LINKED"===n)throw ne(e,"credential-already-in-use",s);if("EMAIL_EXISTS"===n)throw ne(e,"email-already-in-use",s);if("USER_DISABLED"===n)throw ne(e,"user-disabled",s);const a=r[n]||n.toLowerCase().replace(/[_\s]+/g,'-');if(o)throw C(e,a,o);R(e,a)}}catch(t){if(t instanceof f.FirebaseError)throw t;R(e,"network-request-failed",{message:String(t)})}}async function Q(e,t,n,r,i={}){const s=await Y(e,t,n,r,i);return'mfaPendingCredential'in s&&R(e,"multi-factor-auth-required",{_serverResponse:s}),s}async function Z(e,t,n,r){const i=`${t}${n}?${r}`,s=e,o=s.config.emulator?z(e.config,i):`${e.config.apiScheme}://${i}`;if($.includes(n)&&(await s._persistenceManagerAvailable,"COOKIE"===s._getPersistenceType())){return s._getPersistence()._getFinalTarget(o).toString()}return o}function ee(e){switch(e){case'ENFORCE':return"ENFORCE";case'AUDIT':return"AUDIT";case'OFF':return"OFF";default:return"ENFORCEMENT_STATE_UNSPECIFIED"}}class te{clearNetworkTimeout(){clearTimeout(this.timer)}constructor(e){this.auth=e,this.timer=null,this.promise=new Promise((e,t)=>{this.timer=setTimeout(()=>t(N(this.auth,"network-request-failed")),B.get())})}}function ne(e,t,n){const r={appName:e.name};n.email&&(r.email=n.email),n.phoneNumber&&(r.phoneNumber=n.phoneNumber);const i=N(e,t,r);return i.customData._tokenResponse=n,i}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function re(e){return void 0!==e&&void 0!==e.getResponse}function ie(e){return void 0!==e&&void 0!==e.enterprise}class se{constructor(e){if(this.siteKey='',this.recaptchaEnforcementState=[],void 0===e.recaptchaKey)throw new Error('recaptchaKey undefined');this.siteKey=e.recaptchaKey.split('/')[3],this.recaptchaEnforcementState=e.recaptchaEnforcementState}getProviderEnforcementState(e){if(!this.recaptchaEnforcementState||0===this.recaptchaEnforcementState.length)return null;for(const t of this.recaptchaEnforcementState)if(t.provider&&t.provider===e)return ee(t.enforcementState);return null}isProviderEnabled(e){return"ENFORCE"===this.getProviderEnforcementState(e)||"AUDIT"===this.getProviderEnforcementState(e)}isAnyProviderEnabled(){return this.isProviderEnabled("EMAIL_PASSWORD_PROVIDER")||this.isProviderEnabled("PHONE_PROVIDER")}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function oe(e){return(await Y(e,"GET","/v1/recaptchaParams")).recaptchaSiteKey||''}async function ae(e,t){return Y(e,"GET","/v2/recaptchaConfig",J(e,t))}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function ce(e,t){return Y(e,"POST","/v1/accounts:delete",t)}async function ue(e,t){return Y(e,"POST","/v1/accounts:update",t)}async function de(e,t){return Y(e,"POST","/v1/accounts:lookup",t)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function le(e){if(e)try{const t=new Date(Number(e));if(!isNaN(t.getTime()))return t.toUTCString()}catch(e){}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function he(e,t=!1){return(0,f.getModularInstance)(e).getIdToken(t)}async function pe(e,t=!1){const n=(0,f.getModularInstance)(e),r=await n.getIdToken(t),i=me(r);U(i&&i.exp&&i.auth_time&&i.iat,n.auth,"internal-error");const s='object'==typeof i.firebase?i.firebase:void 0,o=s?.sign_in_provider;return{claims:i,token:r,authTime:le(fe(i.auth_time)),issuedAtTime:le(fe(i.iat)),expirationTime:le(fe(i.exp)),signInProvider:o||null,signInSecondFactor:s?.sign_in_second_factor||null}}function fe(e){return 1e3*Number(e)}function me(e){const[t,n,r]=e.split('.');if(void 0===t||void 0===n||void 0===r)return k('JWT malformed, contained fewer than 3 sections'),null;try{const e=(0,f.base64Decode)(n);return e?JSON.parse(e):(k('Failed to decode base64 JWT payload'),null)}catch(e){return k('Caught error parsing JWT payload as JSON',e?.toString()),null}}function ge(e){const t=me(e);return U(t,"internal-error"),U(void 0!==t.exp,"internal-error"),U(void 0!==t.iat,"internal-error"),Number(t.exp)-Number(t.iat)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Ie(e,t,n=!1){if(n)return t;try{return await t}catch(t){throw t instanceof f.FirebaseError&&_e(t)&&e.auth.currentUser===e&&await e.auth.signOut(),t}}function _e({code:e}){return"auth/user-disabled"===e||"auth/user-token-expired"===e}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class ye{constructor(e){this.user=e,this.isRunning=!1,this.timerId=null,this.errorBackoff=3e4}_start(){this.isRunning||(this.isRunning=!0,this.schedule())}_stop(){this.isRunning&&(this.isRunning=!1,null!==this.timerId&&clearTimeout(this.timerId))}getInterval(e){if(e){const e=this.errorBackoff;return this.errorBackoff=Math.min(2*this.errorBackoff,96e4),e}{this.errorBackoff=3e4;const e=(this.user.stsTokenManager.expirationTime??0)-Date.now()-3e5;return Math.max(0,e)}}schedule(e=!1){if(!this.isRunning)return;const t=this.getInterval(e);this.timerId=setTimeout(async()=>{await this.iteration()},t)}async iteration(){try{await this.user.getIdToken(!0)}catch(e){return void("auth/network-request-failed"===e?.code&&this.schedule(!0))}this.schedule()}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class ve{constructor(e,t){this.createdAt=e,this.lastLoginAt=t,this._initializeTime()}_initializeTime(){this.lastSignInTime=le(this.lastLoginAt),this.creationTime=le(this.createdAt)}_copy(e){this.createdAt=e.createdAt,this.lastLoginAt=e.lastLoginAt,this._initializeTime()}toJSON(){return{createdAt:this.createdAt,lastLoginAt:this.lastLoginAt}}}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Te(e){const t=e.auth,n=await e.getIdToken(),r=await Ie(e,de(t,{idToken:n}));U(r?.users.length,t,"internal-error");const i=r.users[0];e._notifyReloadListener(i);const s=i.providerUserInfo?.length?be(i.providerUserInfo):[],o=we(e.providerData,s),a=e.isAnonymous,c=!(e.email&&i.passwordHash||o?.length),u=!!a&&c,d={uid:i.localId,displayName:i.displayName||null,photoURL:i.photoUrl||null,email:i.email||null,emailVerified:i.emailVerified||!1,phoneNumber:i.phoneNumber||null,tenantId:i.tenantId||null,providerData:o,metadata:new ve(i.createdAt,i.lastLoginAt),isAnonymous:u};Object.assign(e,d)}async function Ee(e){const t=(0,f.getModularInstance)(e);await Te(t),await t.auth._persistUserIfCurrent(t),t.auth._notifyListenersIfCurrent(t)}function we(e,t){return[...e.filter(e=>!t.some(t=>t.providerId===e.providerId)),...t]}function be(e){return e.map(e=>{let{providerId:t}=e,n=(0,h.default)(e,a);return{providerId:t,uid:n.rawId||'',displayName:n.displayName||null,email:n.email||null,phoneNumber:n.phoneNumber||null,photoURL:n.photoUrl||null}})}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Pe(e,t){const n=await X(e,{},async()=>{const n=(0,f.querystring)({grant_type:'refresh_token',refresh_token:t}).slice(1),{tokenApiHost:r,apiKey:i}=e.config,s=await Z(e,r,"/v1/token",`key=${i}`),o=await e._getAdditionalHeaders();o["Content-Type"]='application/x-www-form-urlencoded';const a={method:"POST",headers:o,body:n};return e.emulatorConfig&&(0,f.isCloudWorkstation)(e.emulatorConfig.host)&&(a.credentials='include'),G.fetch()(s,a)});return{accessToken:n.access_token,expiresIn:n.expires_in,refreshToken:n.refresh_token}}async function Ae(e,t){return Y(e,"POST","/v2/accounts:revokeToken",J(e,t))}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Se{constructor(){this.refreshToken=null,this.accessToken=null,this.expirationTime=null}get isExpired(){return!this.expirationTime||Date.now()>this.expirationTime-3e4}updateFromServerResponse(e){U(e.idToken,"internal-error"),U(void 0!==e.idToken,"internal-error"),U(void 0!==e.refreshToken,"internal-error");const t='expiresIn'in e&&void 0!==e.expiresIn?Number(e.expiresIn):ge(e.idToken);this.updateTokensAndExpiration(e.idToken,e.refreshToken,t)}updateFromIdToken(e){U(0!==e.length,"internal-error");const t=ge(e);this.updateTokensAndExpiration(e,null,t)}async getToken(e,t=!1){return t||!this.accessToken||this.isExpired?(U(this.refreshToken,e,"user-token-expired"),this.refreshToken?(await this.refresh(e,this.refreshToken),this.accessToken):null):this.accessToken}clearRefreshToken(){this.refreshToken=null}async refresh(e,t){const{accessToken:n,refreshToken:r,expiresIn:i}=await Pe(e,t);this.updateTokensAndExpiration(n,r,Number(i))}updateTokensAndExpiration(e,t,n){this.refreshToken=t||null,this.accessToken=e||null,this.expirationTime=Date.now()+1e3*n}static fromJSON(e,t){const{refreshToken:n,accessToken:r,expirationTime:i}=t,s=new Se;return n&&(U('string'==typeof n,"internal-error",{appName:e}),s.refreshToken=n),r&&(U('string'==typeof r,"internal-error",{appName:e}),s.accessToken=r),i&&(U('number'==typeof i,"internal-error",{appName:e}),s.expirationTime=i),s}toJSON(){return{refreshToken:this.refreshToken,accessToken:this.accessToken,expirationTime:this.expirationTime}}_assign(e){this.accessToken=e.accessToken,this.refreshToken=e.refreshToken,this.expirationTime=e.expirationTime}_clone(){return Object.assign(new Se,this.toJSON())}_performRefresh(){return j('not implemented')}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Oe(e,t){U('string'==typeof e||void 0===e,"internal-error",{appName:t})}class ke{constructor(e){let{uid:t,auth:n,stsTokenManager:r}=e,i=(0,h.default)(e,c);this.providerId="firebase",this.proactiveRefresh=new ye(this),this.reloadUserInfo=null,this.reloadListener=null,this.uid=t,this.auth=n,this.stsTokenManager=r,this.accessToken=r.accessToken,this.displayName=i.displayName||null,this.email=i.email||null,this.emailVerified=i.emailVerified||!1,this.phoneNumber=i.phoneNumber||null,this.photoURL=i.photoURL||null,this.isAnonymous=i.isAnonymous||!1,this.tenantId=i.tenantId||null,this.providerData=i.providerData?[...i.providerData]:[],this.metadata=new ve(i.createdAt||void 0,i.lastLoginAt||void 0)}async getIdToken(e){const t=await Ie(this,this.stsTokenManager.getToken(this.auth,e));return U(t,this.auth,"internal-error"),this.accessToken!==t&&(this.accessToken=t,await this.auth._persistUserIfCurrent(this),this.auth._notifyListenersIfCurrent(this)),t}getIdTokenResult(e){return pe(this,e)}reload(){return Ee(this)}_assign(e){this!==e&&(U(this.uid===e.uid,this.auth,"internal-error"),this.displayName=e.displayName,this.photoURL=e.photoURL,this.email=e.email,this.emailVerified=e.emailVerified,this.phoneNumber=e.phoneNumber,this.isAnonymous=e.isAnonymous,this.tenantId=e.tenantId,this.providerData=e.providerData.map(e=>Object.assign({},e)),this.metadata._copy(e.metadata),this.stsTokenManager._assign(e.stsTokenManager))}_clone(e){const t=new ke(Object.assign({},this,{auth:e,stsTokenManager:this.stsTokenManager._clone()}));return t.metadata._copy(this.metadata),t}_onReload(e){U(!this.reloadListener,this.auth,"internal-error"),this.reloadListener=e,this.reloadUserInfo&&(this._notifyReloadListener(this.reloadUserInfo),this.reloadUserInfo=null)}_notifyReloadListener(e){this.reloadListener?this.reloadListener(e):this.reloadUserInfo=e}_startProactiveRefresh(){this.proactiveRefresh._start()}_stopProactiveRefresh(){this.proactiveRefresh._stop()}async _updateTokensIfNecessary(e,t=!1){let n=!1;e.idToken&&e.idToken!==this.stsTokenManager.accessToken&&(this.stsTokenManager.updateFromServerResponse(e),n=!0),t&&await Te(this),await this.auth._persistUserIfCurrent(this),n&&this.auth._notifyListenersIfCurrent(this)}async delete(){if((0,p._isFirebaseServerApp)(this.auth.app))return Promise.reject(D(this.auth));const e=await this.getIdToken();return await Ie(this,ce(this.auth,{idToken:e})),this.stsTokenManager.clearRefreshToken(),this.auth.signOut()}toJSON(){return Object.assign({uid:this.uid,email:this.email||void 0,emailVerified:this.emailVerified,displayName:this.displayName||void 0,isAnonymous:this.isAnonymous,photoURL:this.photoURL||void 0,phoneNumber:this.phoneNumber||void 0,tenantId:this.tenantId||void 0,providerData:this.providerData.map(e=>Object.assign({},e)),stsTokenManager:this.stsTokenManager.toJSON(),_redirectEventId:this._redirectEventId},this.metadata.toJSON(),{apiKey:this.auth.config.apiKey,appName:this.auth.name})}get refreshToken(){return this.stsTokenManager.refreshToken||''}static _fromJSON(e,t){const n=t.displayName??void 0,r=t.email??void 0,i=t.phoneNumber??void 0,s=t.photoURL??void 0,o=t.tenantId??void 0,a=t._redirectEventId??void 0,c=t.createdAt??void 0,u=t.lastLoginAt??void 0,{uid:d,emailVerified:l,isAnonymous:h,providerData:p,stsTokenManager:f}=t;U(d&&f,e,"internal-error");const m=Se.fromJSON(this.name,f);U('string'==typeof d,e,"internal-error"),Oe(n,e.name),Oe(r,e.name),U('boolean'==typeof l,e,"internal-error"),U('boolean'==typeof h,e,"internal-error"),Oe(i,e.name),Oe(s,e.name),Oe(o,e.name),Oe(a,e.name),Oe(c,e.name),Oe(u,e.name);const g=new ke({uid:d,auth:e,email:r,emailVerified:l,displayName:n,isAnonymous:h,photoURL:s,phoneNumber:i,tenantId:o,stsTokenManager:m,createdAt:c,lastLoginAt:u});return p&&Array.isArray(p)&&(g.providerData=p.map(e=>Object.assign({},e))),a&&(g._redirectEventId=a),g}static async _fromIdTokenResponse(e,t,n=!1){const r=new Se;r.updateFromServerResponse(t);const i=new ke({uid:t.localId,auth:e,stsTokenManager:r,isAnonymous:n});return await Te(i),i}static async _fromGetAccountInfoResponse(e,t,n){const r=t.users[0];U(void 0!==r.localId,"internal-error");const i=void 0!==r.providerUserInfo?be(r.providerUserInfo):[],s=!(r.email&&r.passwordHash||i?.length),o=new Se;o.updateFromIdToken(n);const a=new ke({uid:r.localId,auth:e,stsTokenManager:o,isAnonymous:s}),c={uid:r.localId,displayName:r.displayName||null,photoURL:r.photoUrl||null,email:r.email||null,emailVerified:r.emailVerified||!1,phoneNumber:r.phoneNumber||null,tenantId:r.tenantId||null,providerData:i,metadata:new ve(r.createdAt,r.lastLoginAt),isAnonymous:!(r.email&&r.passwordHash||i?.length)};return Object.assign(a,c),a}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const Re=new Map;function Ne(e){F(e instanceof Function,'Expected a class definition');let t=Re.get(e);return t?(F(t instanceof e,'Instance stored in cache mismatched with class'),t):(t=new e,Re.set(e,t),t)}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Ce{constructor(){this.type="NONE",this.storage={}}async _isAvailable(){return!0}async _set(e,t){this.storage[e]=t}async _get(e){const t=this.storage[e];return void 0===t?null:t}async _remove(e){delete this.storage[e]}_addListener(e,t){}_removeListener(e,t){}}Ce.type='NONE';const De=Ce;
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Le(e,t,n){return`firebase:${e}:${t}:${n}`}class Me{constructor(e,t,n){this.persistence=e,this.auth=t,this.userKey=n;const{config:r,name:i}=this.auth;this.fullUserKey=Le(this.userKey,r.apiKey,i),this.fullPersistenceKey=Le("persistence",r.apiKey,i),this.boundEventHandler=t._onStorageEvent.bind(t),this.persistence._addListener(this.fullUserKey,this.boundEventHandler)}setCurrentUser(e){return this.persistence._set(this.fullUserKey,e.toJSON())}async getCurrentUser(){const e=await this.persistence._get(this.fullUserKey);if(!e)return null;if('string'==typeof e){const t=await de(this.auth,{idToken:e}).catch(()=>{});return t?ke._fromGetAccountInfoResponse(this.auth,t,e):null}return ke._fromJSON(this.auth,e)}removeCurrentUser(){return this.persistence._remove(this.fullUserKey)}savePersistenceForRedirect(){return this.persistence._set(this.fullPersistenceKey,this.persistence.type)}async setPersistence(e){if(this.persistence===e)return;const t=await this.getCurrentUser();return await this.removeCurrentUser(),this.persistence=e,t?this.setCurrentUser(t):void 0}delete(){this.persistence._removeListener(this.fullUserKey,this.boundEventHandler)}static async create(e,t,n="authUser"){if(!t.length)return new Me(Ne(De),e,n);const r=(await Promise.all(t.map(async e=>{if(await e._isAvailable())return e}))).filter(e=>e);let i=r[0]||Ne(De);const s=Le(n,e.config.apiKey,e.name);let o=null;for(const n of t)try{const t=await n._get(s);if(t){let r;if('string'==typeof t){const n=await de(e,{idToken:t}).catch(()=>{});if(!n)break;r=await ke._fromGetAccountInfoResponse(e,n,t)}else r=ke._fromJSON(e,t);n!==i&&(o=r),i=n;break}}catch{}const a=r.filter(e=>e._shouldAllowMigration);return i._shouldAllowMigration&&a.length?(i=a[0],o&&await i._set(s,o.toJSON()),await Promise.all(t.map(async e=>{if(e!==i)try{await e._remove(s)}catch{}})),new Me(i,e,n)):new Me(i,e,n)}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Ue(e){const t=e.toLowerCase();if(t.includes('opera/')||t.includes('opr/')||t.includes('opios/'))return"Opera";if(xe(t))return"IEMobile";if(t.includes('msie')||t.includes('trident/'))return"IE";if(t.includes('edge/'))return"Edge";if(je(t))return"Firefox";if(t.includes('silk/'))return"Silk";if(qe(t))return"Blackberry";if(We(t))return"Webos";if(Fe(t))return"Safari";if((t.includes('chrome/')||Ve(t))&&!t.includes('edge/'))return"Chrome";if(He(t))return"Android";{const t=/([a-zA-Z\d\.]+)\/[a-zA-Z\d\.]*$/,n=e.match(t);if(2===n?.length)return n[1]}return"Other"}function je(e=(0,f.getUA)()){return/firefox\//i.test(e)}function Fe(e=(0,f.getUA)()){const t=e.toLowerCase();return t.includes('safari/')&&!t.includes('chrome/')&&!t.includes('crios/')&&!t.includes('android')}function Ve(e=(0,f.getUA)()){return/crios\//i.test(e)}function xe(e=(0,f.getUA)()){return/iemobile/i.test(e)}function He(e=(0,f.getUA)()){return/android/i.test(e)}function qe(e=(0,f.getUA)()){return/blackberry/i.test(e)}function We(e=(0,f.getUA)()){return/webos/i.test(e)}function ze(e=(0,f.getUA)()){return/iphone|ipad|ipod/i.test(e)||/macintosh/i.test(e)&&/mobile/i.test(e)}function Ge(e=(0,f.getUA)()){return/(iPad|iPhone|iPod).*OS 7_\d/i.test(e)||/(iPad|iPhone|iPod).*OS 8_\d/i.test(e)}function Ke(e=(0,f.getUA)()){return ze(e)&&!!window.navigator?.standalone}function $e(e=(0,f.getUA)()){return ze(e)||He(e)||We(e)||qe(e)||/windows phone/i.test(e)||xe(e)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Be(e,t=[]){let n;switch(e){case"Browser":n=Ue((0,f.getUA)());break;case"Worker":n=`${Ue((0,f.getUA)())}-${e}`;break;default:n=e}const r=t.length?t.join(','):'FirebaseCore-web';return`${n}/JsCore/${p.SDK_VERSION}/${r}`}
/**
   * @license
   * Copyright 2022 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Je{constructor(e){this.auth=e,this.queue=[]}pushCallback(e,t){const n=t=>new Promise((n,r)=>{try{n(e(t))}catch(e){r(e)}});n.onAbort=t,this.queue.push(n);const r=this.queue.length-1;return()=>{this.queue[r]=()=>Promise.resolve()}}async runMiddleware(e){if(this.auth.currentUser===e)return;const t=[];try{for(const n of this.queue)await n(e),n.onAbort&&t.push(n.onAbort)}catch(e){t.reverse();for(const e of t)try{e()}catch(e){}throw this.auth._errorFactory.create("login-blocked",{originalMessage:e?.message})}}}
/**
   * @license
   * Copyright 2023 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Ye(e,t={}){return Y(e,"GET","/v2/passwordPolicy",J(e,t))}
/**
   * @license
   * Copyright 2023 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Xe{constructor(e){const t=e.customStrengthOptions;this.customStrengthOptions={},this.customStrengthOptions.minPasswordLength=t.minPasswordLength??6,t.maxPasswordLength&&(this.customStrengthOptions.maxPasswordLength=t.maxPasswordLength),void 0!==t.containsLowercaseCharacter&&(this.customStrengthOptions.containsLowercaseLetter=t.containsLowercaseCharacter),void 0!==t.containsUppercaseCharacter&&(this.customStrengthOptions.containsUppercaseLetter=t.containsUppercaseCharacter),void 0!==t.containsNumericCharacter&&(this.customStrengthOptions.containsNumericCharacter=t.containsNumericCharacter),void 0!==t.containsNonAlphanumericCharacter&&(this.customStrengthOptions.containsNonAlphanumericCharacter=t.containsNonAlphanumericCharacter),this.enforcementState=e.enforcementState,'ENFORCEMENT_STATE_UNSPECIFIED'===this.enforcementState&&(this.enforcementState='OFF'),this.allowedNonAlphanumericCharacters=e.allowedNonAlphanumericCharacters?.join('')??'',this.forceUpgradeOnSignin=e.forceUpgradeOnSignin??!1,this.schemaVersion=e.schemaVersion}validatePassword(e){const t={isValid:!0,passwordPolicy:this};return this.validatePasswordLengthOptions(e,t),this.validatePasswordCharacterOptions(e,t),t.isValid&&(t.isValid=t.meetsMinPasswordLength??!0),t.isValid&&(t.isValid=t.meetsMaxPasswordLength??!0),t.isValid&&(t.isValid=t.containsLowercaseLetter??!0),t.isValid&&(t.isValid=t.containsUppercaseLetter??!0),t.isValid&&(t.isValid=t.containsNumericCharacter??!0),t.isValid&&(t.isValid=t.containsNonAlphanumericCharacter??!0),t}validatePasswordLengthOptions(e,t){const n=this.customStrengthOptions.minPasswordLength,r=this.customStrengthOptions.maxPasswordLength;n&&(t.meetsMinPasswordLength=e.length>=n),r&&(t.meetsMaxPasswordLength=e.length<=r)}validatePasswordCharacterOptions(e,t){let n;this.updatePasswordCharacterOptionsStatuses(t,!1,!1,!1,!1);for(let r=0;r<e.length;r++)n=e.charAt(r),this.updatePasswordCharacterOptionsStatuses(t,n>='a'&&n<='z',n>='A'&&n<='Z',n>='0'&&n<='9',this.allowedNonAlphanumericCharacters.includes(n))}updatePasswordCharacterOptionsStatuses(e,t,n,r,i){this.customStrengthOptions.containsLowercaseLetter&&(e.containsLowercaseLetter||(e.containsLowercaseLetter=t)),this.customStrengthOptions.containsUppercaseLetter&&(e.containsUppercaseLetter||(e.containsUppercaseLetter=n)),this.customStrengthOptions.containsNumericCharacter&&(e.containsNumericCharacter||(e.containsNumericCharacter=r)),this.customStrengthOptions.containsNonAlphanumericCharacter&&(e.containsNonAlphanumericCharacter||(e.containsNonAlphanumericCharacter=i))}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Qe{constructor(e,t,n,r){this.app=e,this.heartbeatServiceProvider=t,this.appCheckServiceProvider=n,this.config=r,this.currentUser=null,this.emulatorConfig=null,this.operations=Promise.resolve(),this.authStateSubscription=new et(this),this.idTokenSubscription=new et(this),this.beforeStateQueue=new Je(this),this.redirectUser=null,this.isProactiveRefreshEnabled=!1,this.EXPECTED_PASSWORD_POLICY_SCHEMA_VERSION=1,this._canInitEmulator=!0,this._isInitialized=!1,this._deleted=!1,this._initializationPromise=null,this._popupRedirectResolver=null,this._errorFactory=P,this._agentRecaptchaConfig=null,this._tenantRecaptchaConfigs={},this._projectPasswordPolicy=null,this._tenantPasswordPolicies={},this._resolvePersistenceManagerAvailable=void 0,this.lastNotifiedUid=void 0,this.languageCode=null,this.tenantId=null,this.settings={appVerificationDisabledForTesting:!1},this.frameworks=[],this.name=e.name,this.clientVersion=r.sdkClientVersion,this._persistenceManagerAvailable=new Promise(e=>this._resolvePersistenceManagerAvailable=e)}_initializeWithPersistence(e,t){return t&&(this._popupRedirectResolver=Ne(t)),this._initializationPromise=this.queue(async()=>{if(!this._deleted&&(this.persistenceManager=await Me.create(this,e),this._resolvePersistenceManagerAvailable?.(),!this._deleted)){if(this._popupRedirectResolver?._shouldInitProactively)try{await this._popupRedirectResolver._initialize(this)}catch(e){}await this.initializeCurrentUser(t),this.lastNotifiedUid=this.currentUser?.uid||null,this._deleted||(this._isInitialized=!0)}}),this._initializationPromise}async _onStorageEvent(){if(this._deleted)return;const e=await this.assertedPersistence.getCurrentUser();return this.currentUser||e?this.currentUser&&e&&this.currentUser.uid===e.uid?(this._currentUser._assign(e),void await this.currentUser.getIdToken()):void await this._updateCurrentUser(e,!0):void 0}async initializeCurrentUserFromIdToken(e){try{const t=await de(this,{idToken:e}),n=await ke._fromGetAccountInfoResponse(this,t,e);await this.directlySetCurrentUser(n)}catch(e){console.warn('FirebaseServerApp could not login user with provided authIdToken: ',e),await this.directlySetCurrentUser(null)}}async initializeCurrentUser(e){if((0,p._isFirebaseServerApp)(this.app)){const e=this.app.settings.authIdToken;return e?new Promise(t=>{setTimeout(()=>this.initializeCurrentUserFromIdToken(e).then(t,t))}):this.directlySetCurrentUser(null)}const t=await this.assertedPersistence.getCurrentUser();let n=t,r=!1;if(e&&this.config.authDomain){await this.getOrInitRedirectPersistenceManager();const t=this.redirectUser?._redirectEventId,i=n?._redirectEventId,s=await this.tryRedirectSignIn(e);t&&t!==i||!s?.user||(n=s.user,r=!0)}if(!n)return this.directlySetCurrentUser(null);if(!n._redirectEventId){if(r)try{await this.beforeStateQueue.runMiddleware(n)}catch(e){n=t,this._popupRedirectResolver._overrideRedirectResult(this,()=>Promise.reject(e))}return n?this.reloadAndSetCurrentUserOrClear(n):this.directlySetCurrentUser(null)}return U(this._popupRedirectResolver,this,"argument-error"),await this.getOrInitRedirectPersistenceManager(),this.redirectUser&&this.redirectUser._redirectEventId===n._redirectEventId?this.directlySetCurrentUser(n):this.reloadAndSetCurrentUserOrClear(n)}async tryRedirectSignIn(e){let t=null;try{t=await this._popupRedirectResolver._completeRedirectFn(this,e,!0)}catch(e){await this._setRedirectUser(null)}return t}async reloadAndSetCurrentUserOrClear(e){try{await Te(e)}catch(e){if("auth/network-request-failed"!==e?.code)return this.directlySetCurrentUser(null)}return this.directlySetCurrentUser(e)}useDeviceLanguage(){this.languageCode=q()}async _delete(){this._deleted=!0}async updateCurrentUser(e){if((0,p._isFirebaseServerApp)(this.app))return Promise.reject(D(this));const t=e?(0,f.getModularInstance)(e):null;return t&&U(t.auth.config.apiKey===this.config.apiKey,this,"invalid-user-token"),this._updateCurrentUser(t&&t._clone(this))}async _updateCurrentUser(e,t=!1){if(!this._deleted)return e&&U(this.tenantId===e.tenantId,this,"tenant-id-mismatch"),t||await this.beforeStateQueue.runMiddleware(e),this.queue(async()=>{await this.directlySetCurrentUser(e),this.notifyAuthListeners()})}async signOut(){return(0,p._isFirebaseServerApp)(this.app)?Promise.reject(D(this)):(await this.beforeStateQueue.runMiddleware(null),(this.redirectPersistenceManager||this._popupRedirectResolver)&&await this._setRedirectUser(null),this._updateCurrentUser(null,!0))}setPersistence(e){return(0,p._isFirebaseServerApp)(this.app)?Promise.reject(D(this)):this.queue(async()=>{await this.assertedPersistence.setPersistence(Ne(e))})}_getRecaptchaConfig(){return null==this.tenantId?this._agentRecaptchaConfig:this._tenantRecaptchaConfigs[this.tenantId]}async validatePassword(e){this._getPasswordPolicyInternal()||await this._updatePasswordPolicy();const t=this._getPasswordPolicyInternal();return t.schemaVersion!==this.EXPECTED_PASSWORD_POLICY_SCHEMA_VERSION?Promise.reject(this._errorFactory.create("unsupported-password-policy-schema-version",{})):t.validatePassword(e)}_getPasswordPolicyInternal(){return null===this.tenantId?this._projectPasswordPolicy:this._tenantPasswordPolicies[this.tenantId]}async _updatePasswordPolicy(){const e=await Ye(this),t=new Xe(e);null===this.tenantId?this._projectPasswordPolicy=t:this._tenantPasswordPolicies[this.tenantId]=t}_getPersistenceType(){return this.assertedPersistence.persistence.type}_getPersistence(){return this.assertedPersistence.persistence}_updateErrorMap(e){this._errorFactory=new f.ErrorFactory('auth','Firebase',e())}onAuthStateChanged(e,t,n){return this.registerStateListener(this.authStateSubscription,e,t,n)}beforeAuthStateChanged(e,t){return this.beforeStateQueue.pushCallback(e,t)}onIdTokenChanged(e,t,n){return this.registerStateListener(this.idTokenSubscription,e,t,n)}authStateReady(){return new Promise((e,t)=>{if(this.currentUser)e();else{const n=this.onAuthStateChanged(()=>{n(),e()},t)}})}async revokeAccessToken(e){if(this.currentUser){const t={providerId:'apple.com',tokenType:"ACCESS_TOKEN",token:e,idToken:await this.currentUser.getIdToken()};null!=this.tenantId&&(t.tenantId=this.tenantId),await Ae(this,t)}}toJSON(){return{apiKey:this.config.apiKey,authDomain:this.config.authDomain,appName:this.name,currentUser:this._currentUser?.toJSON()}}async _setRedirectUser(e,t){const n=await this.getOrInitRedirectPersistenceManager(t);return null===e?n.removeCurrentUser():n.setCurrentUser(e)}async getOrInitRedirectPersistenceManager(e){if(!this.redirectPersistenceManager){const t=e&&Ne(e)||this._popupRedirectResolver;U(t,this,"argument-error"),this.redirectPersistenceManager=await Me.create(this,[Ne(t._redirectPersistence)],"redirectUser"),this.redirectUser=await this.redirectPersistenceManager.getCurrentUser()}return this.redirectPersistenceManager}async _redirectUserForId(e){return this._isInitialized&&await this.queue(async()=>{}),this._currentUser?._redirectEventId===e?this._currentUser:this.redirectUser?._redirectEventId===e?this.redirectUser:null}async _persistUserIfCurrent(e){if(e===this.currentUser)return this.queue(async()=>this.directlySetCurrentUser(e))}_notifyListenersIfCurrent(e){e===this.currentUser&&this.notifyAuthListeners()}_key(){return`${this.config.authDomain}:${this.config.apiKey}:${this.name}`}_startProactiveRefresh(){this.isProactiveRefreshEnabled=!0,this.currentUser&&this._currentUser._startProactiveRefresh()}_stopProactiveRefresh(){this.isProactiveRefreshEnabled=!1,this.currentUser&&this._currentUser._stopProactiveRefresh()}get _currentUser(){return this.currentUser}notifyAuthListeners(){if(!this._isInitialized)return;this.idTokenSubscription.next(this.currentUser);const e=this.currentUser?.uid??null;this.lastNotifiedUid!==e&&(this.lastNotifiedUid=e,this.authStateSubscription.next(this.currentUser))}registerStateListener(e,t,n,r){if(this._deleted)return()=>{};const i='function'==typeof t?t:t.next.bind(t);let s=!1;const o=this._isInitialized?Promise.resolve():this._initializationPromise;if(U(o,this,"internal-error"),o.then(()=>{s||i(this.currentUser)}),'function'==typeof t){const i=e.addObserver(t,n,r);return()=>{s=!0,i()}}{const n=e.addObserver(t);return()=>{s=!0,n()}}}async directlySetCurrentUser(e){this.currentUser&&this.currentUser!==e&&this._currentUser._stopProactiveRefresh(),e&&this.isProactiveRefreshEnabled&&e._startProactiveRefresh(),this.currentUser=e,e?await this.assertedPersistence.setCurrentUser(e):await this.assertedPersistence.removeCurrentUser()}queue(e){return this.operations=this.operations.then(e,e),this.operations}get assertedPersistence(){return U(this.persistenceManager,this,"internal-error"),this.persistenceManager}_logFramework(e){e&&!this.frameworks.includes(e)&&(this.frameworks.push(e),this.frameworks.sort(),this.clientVersion=Be(this.config.clientPlatform,this._getFrameworks()))}_getFrameworks(){return this.frameworks}async _getAdditionalHeaders(){const e={"X-Client-Version":this.clientVersion};this.app.options.appId&&(e["X-Firebase-gmpid"]=this.app.options.appId);const t=await(this.heartbeatServiceProvider.getImmediate({optional:!0})?.getHeartbeatsHeader());t&&(e["X-Firebase-Client"]=t);const n=await this._getAppCheckToken();return n&&(e["X-Firebase-AppCheck"]=n),e}async _getAppCheckToken(){if((0,p._isFirebaseServerApp)(this.app)&&this.app.settings.appCheckToken)return this.app.settings.appCheckToken;const e=await(this.appCheckServiceProvider.getImmediate({optional:!0})?.getToken());return e?.error&&O(`Error while retrieving App Check token: ${e.error}`),e?.token}}function Ze(e){return(0,f.getModularInstance)(e)}class et{constructor(e){this.auth=e,this.observer=null,this.addObserver=(0,f.createSubscribe)(e=>this.observer=e)}get next(){return U(this.observer,this.auth,"internal-error"),this.observer.next.bind(this.observer)}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */let tt={async loadJS(){throw new Error('Unable to load external scripts')},recaptchaV2Script:'',recaptchaEnterpriseScript:'',gapiScript:''};function nt(e){return tt.loadJS(e)}function rt(e){return`__${e}${Math.floor(1e6*Math.random())}`}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const it=1e12;class st{constructor(e){this.auth=e,this.counter=it,this._widgets=new Map}render(e,t){const n=this.counter;return this._widgets.set(n,new ct(e,this.auth.name,t||{})),this.counter++,n}reset(e){const t=e||it;this._widgets.get(t)?.delete(),this._widgets.delete(t)}getResponse(e){const t=e||it;return this._widgets.get(t)?.getResponse()||''}async execute(e){const t=e||it;return this._widgets.get(t)?.execute(),''}}class ot{constructor(){this.enterprise=new at}ready(e){e()}execute(e,t){return Promise.resolve('token')}render(e,t){return''}}class at{ready(e){e()}execute(e,t){return Promise.resolve('token')}render(e,t){return''}}class ct{constructor(e,t,n){this.params=n,this.timerId=null,this.deleted=!1,this.responseToken=null,this.clickHandler=()=>{this.execute()};const r='string'==typeof e?document.getElementById(e):e;U(r,"argument-error",{appName:t}),this.container=r,this.isVisible='invisible'!==this.params.size,this.isVisible?this.execute():this.container.addEventListener('click',this.clickHandler)}getResponse(){return this.checkIfDeleted(),this.responseToken}delete(){this.checkIfDeleted(),this.deleted=!0,this.timerId&&(clearTimeout(this.timerId),this.timerId=null),this.container.removeEventListener('click',this.clickHandler)}execute(){this.checkIfDeleted(),this.timerId||(this.timerId=window.setTimeout(()=>{this.responseToken=ut(50);const{callback:e,'expired-callback':t}=this.params;if(e)try{e(this.responseToken)}catch(e){}this.timerId=window.setTimeout(()=>{if(this.timerId=null,this.responseToken=null,t)try{t()}catch(e){}this.isVisible&&this.execute()},6e4)},500))}checkIfDeleted(){if(this.deleted)throw new Error('reCAPTCHA mock was already deleted!')}}function ut(e){const t=[],n='1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';for(let r=0;r<e;r++)t.push(n.charAt(Math.floor(62*Math.random())));return t.join('')}const dt='NO_RECAPTCHA';class lt{constructor(e){this.type="recaptcha-enterprise",this.auth=Ze(e)}async verify(e="verify",t=!1){async function n(e){if(!t){if(null==e.tenantId&&null!=e._agentRecaptchaConfig)return e._agentRecaptchaConfig.siteKey;if(null!=e.tenantId&&void 0!==e._tenantRecaptchaConfigs[e.tenantId])return e._tenantRecaptchaConfigs[e.tenantId].siteKey}return new Promise(async(t,n)=>{ae(e,{clientType:"CLIENT_TYPE_WEB",version:"RECAPTCHA_ENTERPRISE"}).then(r=>{if(void 0!==r.recaptchaKey){const n=new se(r);return null==e.tenantId?e._agentRecaptchaConfig=n:e._tenantRecaptchaConfigs[e.tenantId]=n,t(n.siteKey)}n(new Error('recaptcha Enterprise site key undefined'))}).catch(e=>{n(e)})})}function r(t,n,r){const i=window.grecaptcha;ie(i)?i.enterprise.ready(()=>{i.enterprise.execute(t,{action:e}).then(e=>{n(e)}).catch(()=>{n(dt)})}):r(Error('No reCAPTCHA enterprise script loaded.'))}if(this.auth.settings.appVerificationDisabledForTesting){return(new ot).execute('siteKey',{action:'verify'})}return new Promise((e,i)=>{n(this.auth).then(n=>{if(!t&&ie(window.grecaptcha))r(n,e,i);else{if('undefined'==typeof window)return void i(new Error('RecaptchaVerifier is only supported in browser'));let t=tt.recaptchaEnterpriseScript;0!==t.length&&(t+=n),nt(t).then(()=>{r(n,e,i)}).catch(e=>{i(e)})}}).catch(e=>{i(e)})})}}async function ht(e,t,n,r=!1,i=!1){const s=new lt(e);let o;if(i)o=dt;else try{o=await s.verify(n)}catch(e){o=await s.verify(n,!0)}const a=Object.assign({},t);if("mfaSmsEnrollment"===n||"mfaSmsSignIn"===n){if('phoneEnrollmentInfo'in a){const e=a.phoneEnrollmentInfo.phoneNumber,t=a.phoneEnrollmentInfo.recaptchaToken;Object.assign(a,{phoneEnrollmentInfo:{phoneNumber:e,recaptchaToken:t,captchaResponse:o,clientType:"CLIENT_TYPE_WEB",recaptchaVersion:"RECAPTCHA_ENTERPRISE"}})}else if('phoneSignInInfo'in a){const e=a.phoneSignInInfo.recaptchaToken;Object.assign(a,{phoneSignInInfo:{recaptchaToken:e,captchaResponse:o,clientType:"CLIENT_TYPE_WEB",recaptchaVersion:"RECAPTCHA_ENTERPRISE"}})}return a}return r?Object.assign(a,{captchaResp:o}):Object.assign(a,{captchaResponse:o}),Object.assign(a,{clientType:"CLIENT_TYPE_WEB"}),Object.assign(a,{recaptchaVersion:"RECAPTCHA_ENTERPRISE"}),a}async function pt(e,t,n,r,i){if("EMAIL_PASSWORD_PROVIDER"===i){if(e._getRecaptchaConfig()?.isProviderEnabled("EMAIL_PASSWORD_PROVIDER")){const i=await ht(e,t,n,"getOobCode"===n);return r(e,i)}return r(e,t).catch(async i=>{if("auth/missing-recaptcha-token"===i.code){console.log(`${n} is protected by reCAPTCHA Enterprise for this project. Automatically triggering the reCAPTCHA flow and restarting the flow.`);const i=await ht(e,t,n,"getOobCode"===n);return r(e,i)}return Promise.reject(i)})}if("PHONE_PROVIDER"===i){if(e._getRecaptchaConfig()?.isProviderEnabled("PHONE_PROVIDER")){const i=await ht(e,t,n);return r(e,i).catch(async i=>{if("AUDIT"===e._getRecaptchaConfig()?.getProviderEnforcementState("PHONE_PROVIDER")&&("auth/missing-recaptcha-token"===i.code||"auth/invalid-app-credential"===i.code)){console.log(`Failed to verify with reCAPTCHA Enterprise. Automatically triggering the reCAPTCHA v2 flow to complete the ${n} flow.`);const i=await ht(e,t,n,!1,!0);return r(e,i)}return Promise.reject(i)})}{const i=await ht(e,t,n,!1,!0);return r(e,i)}}return Promise.reject(i+' provider is not supported.')}async function ft(e){const t=Ze(e),n=await ae(t,{clientType:"CLIENT_TYPE_WEB",version:"RECAPTCHA_ENTERPRISE"}),r=new se(n);if(null==t.tenantId?t._agentRecaptchaConfig=r:t._tenantRecaptchaConfigs[t.tenantId]=r,r.isAnyProviderEnabled()){new lt(t).verify()}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function mt(e,t){const n=(0,p._getProvider)(e,'auth');if(n.isInitialized()){const e=n.getImmediate(),r=n.getOptions();if((0,f.deepEqual)(r,t??{}))return e;R(e,"already-initialized")}return n.initialize({options:t})}function gt(e,t){const n=t?.persistence||[],r=(Array.isArray(n)?n:[n]).map(Ne);t?.errorMap&&e._updateErrorMap(t.errorMap),e._initializeWithPersistence(r,t?.popupRedirectResolver)}function It(e,t,n){const r=Ze(e);U(/^https?:\/\//.test(t),r,"invalid-emulator-scheme");const i=!!n?.disableWarnings,s=_t(t),{host:o,port:a}=yt(t),c=null===a?'':`:${a}`,u={url:`${s}//${o}${c}/`},d=Object.freeze({host:o,port:a,protocol:s.replace(':',''),options:Object.freeze({disableWarnings:i})});if(!r._canInitEmulator)return U(r.config.emulator&&r.emulatorConfig,r,"emulator-config-failed"),void U((0,f.deepEqual)(u,r.config.emulator)&&(0,f.deepEqual)(d,r.emulatorConfig),r,"emulator-config-failed");r.config.emulator=u,r.emulatorConfig=d,r.settings.appVerificationDisabledForTesting=!0,(0,f.isCloudWorkstation)(o)?((0,f.pingServer)(`${s}//${o}${c}`),(0,f.updateEmulatorBanner)('Auth',!0)):i||Tt()}function _t(e){const t=e.indexOf(':');return t<0?'':e.substr(0,t+1)}function yt(e){const t=_t(e),n=/(\/\/)?([^?#/]+)/.exec(e.substr(t.length));if(!n)return{host:'',port:null};const r=n[2].split('@').pop()||'',i=/^(\[[^\]]+\])(:|$)/.exec(r);if(i){const e=i[1];return{host:e,port:vt(r.substr(e.length+1))}}{const[e,t]=r.split(':');return{host:e,port:vt(t)}}}function vt(e){if(!e)return null;const t=Number(e);return isNaN(t)?null:t}function Tt(){function e(){const e=document.createElement('p'),t=e.style;e.innerText='Running in emulator mode. Do not use with production credentials.',t.position='fixed',t.width='100%',t.backgroundColor='#ffffff',t.border='.1em solid #000000',t.color='#b50000',t.bottom='0px',t.left='0px',t.margin='0px',t.zIndex='10000',t.textAlign='center',e.classList.add('firebase-emulator-warning'),document.body.appendChild(e)}'undefined'!=typeof console&&'function'==typeof console.info&&console.info("WARNING: You are using the Auth Emulator, which is intended for local testing only.  Do not use with production credentials."),'undefined'!=typeof window&&'undefined'!=typeof document&&('loading'===document.readyState?window.addEventListener('DOMContentLoaded',e):e())}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Et{constructor(e,t){this.providerId=e,this.signInMethod=t}toJSON(){return j('not implemented')}_getIdTokenResponse(e){return j('not implemented')}_linkToIdToken(e,t){return j('not implemented')}_getReauthenticationResolver(e){return j('not implemented')}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function wt(e,t){return Y(e,"POST","/v1/accounts:resetPassword",J(e,t))}async function bt(e,t){return Y(e,"POST","/v1/accounts:update",t)}async function Pt(e,t){return Y(e,"POST","/v1/accounts:signUp",t)}async function At(e,t){return Y(e,"POST","/v1/accounts:update",J(e,t))}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function St(e,t){return Q(e,"POST","/v1/accounts:signInWithPassword",J(e,t))}async function Ot(e,t){return Y(e,"POST","/v1/accounts:sendOobCode",J(e,t))}async function kt(e,t){return Ot(e,t)}async function Rt(e,t){return Ot(e,t)}async function Nt(e,t){return Ot(e,t)}async function Ct(e,t){return Ot(e,t)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Dt(e,t){return Q(e,"POST","/v1/accounts:signInWithEmailLink",J(e,t))}async function Lt(e,t){return Q(e,"POST","/v1/accounts:signInWithEmailLink",J(e,t))}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Mt extends Et{constructor(e,t,n,r=null){super("password",n),this._email=e,this._password=t,this._tenantId=r}static _fromEmailAndPassword(e,t){return new Mt(e,t,"password")}static _fromEmailAndCode(e,t,n=null){return new Mt(e,t,"emailLink",n)}toJSON(){return{email:this._email,password:this._password,signInMethod:this.signInMethod,tenantId:this._tenantId}}static fromJSON(e){const t='string'==typeof e?JSON.parse(e):e;if(t?.email&&t?.password){if("password"===t.signInMethod)return this._fromEmailAndPassword(t.email,t.password);if("emailLink"===t.signInMethod)return this._fromEmailAndCode(t.email,t.password,t.tenantId)}return null}async _getIdTokenResponse(e){switch(this.signInMethod){case"password":return pt(e,{returnSecureToken:!0,email:this._email,password:this._password,clientType:"CLIENT_TYPE_WEB"},"signInWithPassword",St,"EMAIL_PASSWORD_PROVIDER");case"emailLink":return Dt(e,{email:this._email,oobCode:this._password});default:R(e,"internal-error")}}async _linkToIdToken(e,t){switch(this.signInMethod){case"password":return pt(e,{idToken:t,returnSecureToken:!0,email:this._email,password:this._password,clientType:"CLIENT_TYPE_WEB"},"signUpPassword",Pt,"EMAIL_PASSWORD_PROVIDER");case"emailLink":return Lt(e,{idToken:t,email:this._email,oobCode:this._password});default:R(e,"internal-error")}}_getReauthenticationResolver(e){return this._getIdTokenResponse(e)}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Ut(e,t){return Q(e,"POST","/v1/accounts:signInWithIdp",J(e,t))}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class jt extends Et{constructor(){super(...arguments),this.pendingToken=null}static _fromParams(e){const t=new jt(e.providerId,e.signInMethod);return e.idToken||e.accessToken?(e.idToken&&(t.idToken=e.idToken),e.accessToken&&(t.accessToken=e.accessToken),e.nonce&&!e.pendingToken&&(t.nonce=e.nonce),e.pendingToken&&(t.pendingToken=e.pendingToken)):e.oauthToken&&e.oauthTokenSecret?(t.accessToken=e.oauthToken,t.secret=e.oauthTokenSecret):R("argument-error"),t}toJSON(){return{idToken:this.idToken,accessToken:this.accessToken,secret:this.secret,nonce:this.nonce,pendingToken:this.pendingToken,providerId:this.providerId,signInMethod:this.signInMethod}}static fromJSON(e){const t='string'==typeof e?JSON.parse(e):e,{providerId:n,signInMethod:r}=t,i=(0,h.default)(t,u);if(!n||!r)return null;const s=new jt(n,r);return s.idToken=i.idToken||void 0,s.accessToken=i.accessToken||void 0,s.secret=i.secret,s.nonce=i.nonce,s.pendingToken=i.pendingToken||null,s}_getIdTokenResponse(e){return Ut(e,this.buildRequest())}_linkToIdToken(e,t){const n=this.buildRequest();return n.idToken=t,Ut(e,n)}_getReauthenticationResolver(e){const t=this.buildRequest();return t.autoCreate=!1,Ut(e,t)}buildRequest(){const e={requestUri:"http://localhost",returnSecureToken:!0};if(this.pendingToken)e.pendingToken=this.pendingToken;else{const t={};this.idToken&&(t.id_token=this.idToken),this.accessToken&&(t.access_token=this.accessToken),this.secret&&(t.oauth_token_secret=this.secret),t.providerId=this.providerId,this.nonce&&!this.pendingToken&&(t.nonce=this.nonce),e.postBody=(0,f.querystring)(t)}return e}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Ft(e,t){return Y(e,"POST","/v1/accounts:sendVerificationCode",J(e,t))}async function Vt(e,t){return Q(e,"POST","/v1/accounts:signInWithPhoneNumber",J(e,t))}async function xt(e,t){const n=await Q(e,"POST","/v1/accounts:signInWithPhoneNumber",J(e,t));if(n.temporaryProof)throw ne(e,"account-exists-with-different-credential",n);return n}const Ht={USER_NOT_FOUND:"user-not-found"};async function qt(e,t){return Q(e,"POST","/v1/accounts:signInWithPhoneNumber",J(e,Object.assign({},t,{operation:'REAUTH'})),Ht)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Wt extends Et{constructor(e){super("phone","phone"),this.params=e}static _fromVerification(e,t){return new Wt({verificationId:e,verificationCode:t})}static _fromTokenResponse(e,t){return new Wt({phoneNumber:e,temporaryProof:t})}_getIdTokenResponse(e){return Vt(e,this._makeVerificationRequest())}_linkToIdToken(e,t){return xt(e,Object.assign({idToken:t},this._makeVerificationRequest()))}_getReauthenticationResolver(e){return qt(e,this._makeVerificationRequest())}_makeVerificationRequest(){const{temporaryProof:e,phoneNumber:t,verificationId:n,verificationCode:r}=this.params;return e&&t?{temporaryProof:e,phoneNumber:t}:{sessionInfo:n,code:r}}toJSON(){const e={providerId:this.providerId};return this.params.phoneNumber&&(e.phoneNumber=this.params.phoneNumber),this.params.temporaryProof&&(e.temporaryProof=this.params.temporaryProof),this.params.verificationCode&&(e.verificationCode=this.params.verificationCode),this.params.verificationId&&(e.verificationId=this.params.verificationId),e}static fromJSON(e){'string'==typeof e&&(e=JSON.parse(e));const{verificationId:t,verificationCode:n,phoneNumber:r,temporaryProof:i}=e;return n||t||r||i?new Wt({verificationId:t,verificationCode:n,phoneNumber:r,temporaryProof:i}):null}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function zt(e){switch(e){case'recoverEmail':return"RECOVER_EMAIL";case'resetPassword':return"PASSWORD_RESET";case'signIn':return"EMAIL_SIGNIN";case'verifyEmail':return"VERIFY_EMAIL";case'verifyAndChangeEmail':return"VERIFY_AND_CHANGE_EMAIL";case'revertSecondFactorAddition':return"REVERT_SECOND_FACTOR_ADDITION";default:return null}}function Gt(e){const t=(0,f.querystringDecode)((0,f.extractQuerystring)(e)).link,n=t?(0,f.querystringDecode)((0,f.extractQuerystring)(t)).deep_link_id:null,r=(0,f.querystringDecode)((0,f.extractQuerystring)(e)).deep_link_id;return(r?(0,f.querystringDecode)((0,f.extractQuerystring)(r)).link:null)||r||n||t||e}class Kt{constructor(e){const t=(0,f.querystringDecode)((0,f.extractQuerystring)(e)),n=t.apiKey??null,r=t.oobCode??null,i=zt(t.mode??null);U(n&&r&&i,"argument-error"),this.apiKey=n,this.operation=i,this.code=r,this.continueUrl=t.continueUrl??null,this.languageCode=t.lang??null,this.tenantId=t.tenantId??null}static parseLink(e){const t=Gt(e);try{return new Kt(t)}catch{return null}}}function $t(e){return Kt.parseLink(e)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Bt{constructor(){this.providerId=Bt.PROVIDER_ID}static credential(e,t){return Mt._fromEmailAndPassword(e,t)}static credentialWithLink(e,t){const n=Kt.parseLink(t);return U(n,"argument-error"),Mt._fromEmailAndCode(e,n.code,n.tenantId)}}Bt.PROVIDER_ID="password",Bt.EMAIL_PASSWORD_SIGN_IN_METHOD="password",Bt.EMAIL_LINK_SIGN_IN_METHOD="emailLink";
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
class Jt{constructor(e){this.providerId=e,this.defaultLanguageCode=null,this.customParameters={}}setDefaultLanguage(e){this.defaultLanguageCode=e}setCustomParameters(e){return this.customParameters=e,this}getCustomParameters(){return this.customParameters}}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Yt extends Jt{constructor(){super(...arguments),this.scopes=[]}addScope(e){return this.scopes.includes(e)||this.scopes.push(e),this}getScopes(){return[...this.scopes]}}class Xt extends Yt{static credentialFromJSON(e){const t='string'==typeof e?JSON.parse(e):e;return U('providerId'in t&&'signInMethod'in t,"argument-error"),jt._fromParams(t)}credential(e){return this._credential(Object.assign({},e,{nonce:e.rawNonce}))}_credential(e){return U(e.idToken||e.accessToken,"argument-error"),jt._fromParams(Object.assign({},e,{providerId:this.providerId,signInMethod:this.providerId}))}static credentialFromResult(e){return Xt.oauthCredentialFromTaggedObject(e)}static credentialFromError(e){return Xt.oauthCredentialFromTaggedObject(e.customData||{})}static oauthCredentialFromTaggedObject({_tokenResponse:e}){if(!e)return null;const{oauthIdToken:t,oauthAccessToken:n,oauthTokenSecret:r,pendingToken:i,nonce:s,providerId:o}=e;if(!(n||r||t||i))return null;if(!o)return null;try{return new Xt(o)._credential({idToken:t,accessToken:n,nonce:s,pendingToken:i})}catch(e){return null}}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Qt extends Yt{constructor(){super("facebook.com")}static credential(e){return jt._fromParams({providerId:Qt.PROVIDER_ID,signInMethod:Qt.FACEBOOK_SIGN_IN_METHOD,accessToken:e})}static credentialFromResult(e){return Qt.credentialFromTaggedObject(e)}static credentialFromError(e){return Qt.credentialFromTaggedObject(e.customData||{})}static credentialFromTaggedObject({_tokenResponse:e}){if(!e||!('oauthAccessToken'in e))return null;if(!e.oauthAccessToken)return null;try{return Qt.credential(e.oauthAccessToken)}catch{return null}}}Qt.FACEBOOK_SIGN_IN_METHOD="facebook.com",Qt.PROVIDER_ID="facebook.com";
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
class Zt extends Yt{constructor(){super("google.com"),this.addScope('profile')}static credential(e,t){return jt._fromParams({providerId:Zt.PROVIDER_ID,signInMethod:Zt.GOOGLE_SIGN_IN_METHOD,idToken:e,accessToken:t})}static credentialFromResult(e){return Zt.credentialFromTaggedObject(e)}static credentialFromError(e){return Zt.credentialFromTaggedObject(e.customData||{})}static credentialFromTaggedObject({_tokenResponse:e}){if(!e)return null;const{oauthIdToken:t,oauthAccessToken:n}=e;if(!t&&!n)return null;try{return Zt.credential(t,n)}catch{return null}}}Zt.GOOGLE_SIGN_IN_METHOD="google.com",Zt.PROVIDER_ID="google.com";
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
class en extends Yt{constructor(){super("github.com")}static credential(e){return jt._fromParams({providerId:en.PROVIDER_ID,signInMethod:en.GITHUB_SIGN_IN_METHOD,accessToken:e})}static credentialFromResult(e){return en.credentialFromTaggedObject(e)}static credentialFromError(e){return en.credentialFromTaggedObject(e.customData||{})}static credentialFromTaggedObject({_tokenResponse:e}){if(!e||!('oauthAccessToken'in e))return null;if(!e.oauthAccessToken)return null;try{return en.credential(e.oauthAccessToken)}catch{return null}}}en.GITHUB_SIGN_IN_METHOD="github.com",en.PROVIDER_ID="github.com";class tn extends Et{constructor(e,t){super(e,e),this.pendingToken=t}_getIdTokenResponse(e){return Ut(e,this.buildRequest())}_linkToIdToken(e,t){const n=this.buildRequest();return n.idToken=t,Ut(e,n)}_getReauthenticationResolver(e){const t=this.buildRequest();return t.autoCreate=!1,Ut(e,t)}toJSON(){return{signInMethod:this.signInMethod,providerId:this.providerId,pendingToken:this.pendingToken}}static fromJSON(e){const t='string'==typeof e?JSON.parse(e):e,{providerId:n,signInMethod:r,pendingToken:i}=t;return n&&r&&i&&n===r?new tn(n,i):null}static _create(e,t){return new tn(e,t)}buildRequest(){return{requestUri:"http://localhost",returnSecureToken:!0,pendingToken:this.pendingToken}}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class nn extends Jt{constructor(e){U(e.startsWith("saml."),"argument-error"),super(e)}static credentialFromResult(e){return nn.samlCredentialFromTaggedObject(e)}static credentialFromError(e){return nn.samlCredentialFromTaggedObject(e.customData||{})}static credentialFromJSON(e){const t=tn.fromJSON(e);return U(t,"argument-error"),t}static samlCredentialFromTaggedObject({_tokenResponse:e}){if(!e)return null;const{pendingToken:t,providerId:n}=e;if(!t||!n)return null;try{return tn._create(n,t)}catch(e){return null}}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class rn extends Yt{constructor(){super("twitter.com")}static credential(e,t){return jt._fromParams({providerId:rn.PROVIDER_ID,signInMethod:rn.TWITTER_SIGN_IN_METHOD,oauthToken:e,oauthTokenSecret:t})}static credentialFromResult(e){return rn.credentialFromTaggedObject(e)}static credentialFromError(e){return rn.credentialFromTaggedObject(e.customData||{})}static credentialFromTaggedObject({_tokenResponse:e}){if(!e)return null;const{oauthAccessToken:t,oauthTokenSecret:n}=e;if(!t||!n)return null;try{return rn.credential(t,n)}catch{return null}}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
async function sn(e,t){return Q(e,"POST","/v1/accounts:signUp",J(e,t))}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */rn.TWITTER_SIGN_IN_METHOD="twitter.com",rn.PROVIDER_ID="twitter.com";class on{constructor(e){this.user=e.user,this.providerId=e.providerId,this._tokenResponse=e._tokenResponse,this.operationType=e.operationType}static async _fromIdTokenResponse(e,t,n,r=!1){const i=await ke._fromIdTokenResponse(e,n,r),s=an(n);return new on({user:i,providerId:s,_tokenResponse:n,operationType:t})}static async _forOperation(e,t,n){await e._updateTokensIfNecessary(n,!0);const r=an(n);return new on({user:e,providerId:r,_tokenResponse:n,operationType:t})}}function an(e){return e.providerId?e.providerId:'phoneNumber'in e?"phone":null}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function cn(e){if((0,p._isFirebaseServerApp)(e.app))return Promise.reject(D(e));const t=Ze(e);if(await t._initializationPromise,t.currentUser?.isAnonymous)return new on({user:t.currentUser,providerId:null,operationType:"signIn"});const n=await sn(t,{returnSecureToken:!0}),r=await on._fromIdTokenResponse(t,"signIn",n,!0);return await t._updateCurrentUser(r.user),r}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class un extends f.FirebaseError{constructor(e,t,n,r){super(t.code,t.message),this.operationType=n,this.user=r,Object.setPrototypeOf(this,un.prototype),this.customData={appName:e.name,tenantId:e.tenantId??void 0,_serverResponse:t.customData._serverResponse,operationType:n}}static _fromErrorAndOperation(e,t,n,r){return new un(e,t,n,r)}}function dn(e,t,n,r){return("reauthenticate"===t?n._getReauthenticationResolver(e):n._getIdTokenResponse(e)).catch(n=>{if("auth/multi-factor-auth-required"===n.code)throw un._fromErrorAndOperation(e,n,t,r);throw n})}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function ln(e){return new Set(e.map(({providerId:e})=>e).filter(e=>!!e))}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function hn(e,t){const n=(0,f.getModularInstance)(e);await fn(!0,n,t);const{providerUserInfo:r}=await ue(n.auth,{idToken:await n.getIdToken(),deleteProvider:[t]}),i=ln(r||[]);return n.providerData=n.providerData.filter(e=>i.has(e.providerId)),i.has("phone")||(n.phoneNumber=null),await n.auth._persistUserIfCurrent(n),n}async function pn(e,t,n=!1){const r=await Ie(e,t._linkToIdToken(e.auth,await e.getIdToken()),n);return on._forOperation(e,"link",r)}async function fn(e,t,n){await Te(t);const r=!1===e?"provider-already-linked":"no-such-provider";U(ln(t.providerData).has(n)===e,t.auth,r)}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function mn(e,t,n=!1){const{auth:r}=e;if((0,p._isFirebaseServerApp)(r.app))return Promise.reject(D(r));const i="reauthenticate";try{const s=await Ie(e,dn(r,i,t,e),n);U(s.idToken,r,"internal-error");const o=me(s.idToken);U(o,r,"internal-error");const{sub:a}=o;return U(e.uid===a,r,"user-mismatch"),on._forOperation(e,i,s)}catch(e){throw"auth/user-not-found"===e?.code&&R(r,"user-mismatch"),e}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function gn(e,t,n=!1){if((0,p._isFirebaseServerApp)(e.app))return Promise.reject(D(e));const r="signIn",i=await dn(e,r,t),s=await on._fromIdTokenResponse(e,r,i);return n||await e._updateCurrentUser(s.user),s}async function In(e,t){return gn(Ze(e),t)}async function _n(e,t){const n=(0,f.getModularInstance)(e);return await fn(!1,n,t.providerId),pn(n,t)}async function yn(e,t){return mn((0,f.getModularInstance)(e),t)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function vn(e,t){return Q(e,"POST","/v1/accounts:signInWithCustomToken",J(e,t))}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Tn(e,t){if((0,p._isFirebaseServerApp)(e.app))return Promise.reject(D(e));const n=Ze(e),r=await vn(n,{token:t,returnSecureToken:!0}),i=await on._fromIdTokenResponse(n,"signIn",r);return await n._updateCurrentUser(i.user),i}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class En{constructor(e,t){this.factorId=e,this.uid=t.mfaEnrollmentId,this.enrollmentTime=new Date(t.enrolledAt).toUTCString(),this.displayName=t.displayName}static _fromServerResponse(e,t){return'phoneInfo'in t?wn._fromServerResponse(e,t):'totpInfo'in t?bn._fromServerResponse(e,t):R(e,"internal-error")}}class wn extends En{constructor(e){super("phone",e),this.phoneNumber=e.phoneInfo}static _fromServerResponse(e,t){return new wn(t)}}class bn extends En{constructor(e){super("totp",e)}static _fromServerResponse(e,t){return new bn(t)}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Pn(e,t,n){U(n.url?.length>0,e,"invalid-continue-uri"),U(void 0===n.dynamicLinkDomain||n.dynamicLinkDomain.length>0,e,"invalid-dynamic-link-domain"),U(void 0===n.linkDomain||n.linkDomain.length>0,e,"invalid-hosting-link-domain"),t.continueUrl=n.url,t.dynamicLinkDomain=n.dynamicLinkDomain,t.linkDomain=n.linkDomain,t.canHandleCodeInApp=n.handleCodeInApp,n.iOS&&(U(n.iOS.bundleId.length>0,e,"missing-ios-bundle-id"),t.iOSBundleId=n.iOS.bundleId),n.android&&(U(n.android.packageName.length>0,e,"missing-android-pkg-name"),t.androidInstallApp=n.android.installApp,t.androidMinimumVersionCode=n.android.minimumVersion,t.androidPackageName=n.android.packageName)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function An(e){const t=Ze(e);t._getPasswordPolicyInternal()&&await t._updatePasswordPolicy()}async function Sn(e,t,n){const r=Ze(e),i={requestType:"PASSWORD_RESET",email:t,clientType:"CLIENT_TYPE_WEB"};n&&Pn(r,i,n),await pt(r,i,"getOobCode",Rt,"EMAIL_PASSWORD_PROVIDER")}async function On(e,t,n){await wt((0,f.getModularInstance)(e),{oobCode:t,newPassword:n}).catch(async t=>{throw"auth/password-does-not-meet-requirements"===t.code&&An(e),t})}async function kn(e,t){await At((0,f.getModularInstance)(e),{oobCode:t})}async function Rn(e,t){const n=(0,f.getModularInstance)(e),r=await wt(n,{oobCode:t}),i=r.requestType;switch(U(i,n,"internal-error"),i){case"EMAIL_SIGNIN":break;case"VERIFY_AND_CHANGE_EMAIL":U(r.newEmail,n,"internal-error");break;case"REVERT_SECOND_FACTOR_ADDITION":U(r.mfaInfo,n,"internal-error");default:U(r.email,n,"internal-error")}let s=null;return r.mfaInfo&&(s=En._fromServerResponse(Ze(n),r.mfaInfo)),{data:{email:("VERIFY_AND_CHANGE_EMAIL"===r.requestType?r.newEmail:r.email)||null,previousEmail:("VERIFY_AND_CHANGE_EMAIL"===r.requestType?r.email:r.newEmail)||null,multiFactorInfo:s},operation:i}}async function Nn(e,t){const{data:n}=await Rn((0,f.getModularInstance)(e),t);return n.email}async function Cn(e,t,n){if((0,p._isFirebaseServerApp)(e.app))return Promise.reject(D(e));const r=Ze(e),i=pt(r,{returnSecureToken:!0,email:t,password:n,clientType:"CLIENT_TYPE_WEB"},"signUpPassword",sn,"EMAIL_PASSWORD_PROVIDER"),s=await i.catch(t=>{throw"auth/password-does-not-meet-requirements"===t.code&&An(e),t}),o=await on._fromIdTokenResponse(r,"signIn",s);return await r._updateCurrentUser(o.user),o}function Dn(e,t,n){return(0,p._isFirebaseServerApp)(e.app)?Promise.reject(D(e)):In((0,f.getModularInstance)(e),Bt.credential(t,n)).catch(async t=>{throw"auth/password-does-not-meet-requirements"===t.code&&An(e),t})}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Ln(e,t,n){const r=Ze(e),i={requestType:"EMAIL_SIGNIN",email:t,clientType:"CLIENT_TYPE_WEB"};!(function(e,t){U(t.handleCodeInApp,r,"argument-error"),t&&Pn(r,e,t)})(i,n),await pt(r,i,"getOobCode",Nt,"EMAIL_PASSWORD_PROVIDER")}function Mn(e,t){const n=Kt.parseLink(t);return"EMAIL_SIGNIN"===n?.operation}async function Un(e,t,n){if((0,p._isFirebaseServerApp)(e.app))return Promise.reject(D(e));const r=(0,f.getModularInstance)(e),i=Bt.credentialWithLink(t,n||V());return U(i._tenantId===(r.tenantId||null),r,"tenant-id-mismatch"),In(r,i)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function jn(e,t){return Y(e,"POST","/v1/accounts:createAuthUri",J(e,t))}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Fn(e,t){const n={identifier:t,continueUri:x()?V():'http://localhost'},{signinMethods:r}=await jn((0,f.getModularInstance)(e),n);return r||[]}async function Vn(e,t){const n=(0,f.getModularInstance)(e),r={requestType:"VERIFY_EMAIL",idToken:await e.getIdToken()};t&&Pn(n.auth,r,t);const{email:i}=await kt(n.auth,r);i!==e.email&&await e.reload()}async function xn(e,t,n){const r=(0,f.getModularInstance)(e),i={requestType:"VERIFY_AND_CHANGE_EMAIL",idToken:await e.getIdToken(),newEmail:t};n&&Pn(r.auth,i,n);const{email:s}=await Ct(r.auth,i);s!==e.email&&await e.reload()}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Hn(e,t){return Y(e,"POST","/v1/accounts:update",t)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function qn(e,{displayName:t,photoURL:n}){if(void 0===t&&void 0===n)return;const r=(0,f.getModularInstance)(e),i={idToken:await r.getIdToken(),displayName:t,photoUrl:n,returnSecureToken:!0},s=await Ie(r,Hn(r.auth,i));r.displayName=s.displayName||null,r.photoURL=s.photoUrl||null;const o=r.providerData.find(({providerId:e})=>"password"===e);o&&(o.displayName=r.displayName,o.photoURL=r.photoURL),await r._updateTokensIfNecessary(s)}function Wn(e,t){const n=(0,f.getModularInstance)(e);return(0,p._isFirebaseServerApp)(n.auth.app)?Promise.reject(D(n.auth)):Gn(n,t,null)}function zn(e,t){return Gn((0,f.getModularInstance)(e),null,t)}async function Gn(e,t,n){const{auth:r}=e,i={idToken:await e.getIdToken(),returnSecureToken:!0};t&&(i.email=t),n&&(i.password=n);const s=await Ie(e,bt(r,i));await e._updateTokensIfNecessary(s,!0)}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Kn(e){if(!e)return null;const{providerId:t}=e,n=e.rawUserInfo?JSON.parse(e.rawUserInfo):{},r=e.isNewUser||"identitytoolkit#SignupNewUserResponse"===e.kind;if(!t&&e?.idToken){const t=me(e.idToken)?.firebase?.sign_in_provider;if(t){return new $n(r,"anonymous"!==t&&"custom"!==t?t:null)}}if(!t)return null;switch(t){case"facebook.com":return new Jn(r,n);case"github.com":return new Yn(r,n);case"google.com":return new Xn(r,n);case"twitter.com":return new Qn(r,n,e.screenName||null);case"custom":case"anonymous":return new $n(r,null);default:return new $n(r,t,n)}}class $n{constructor(e,t,n={}){this.isNewUser=e,this.providerId=t,this.profile=n}}class Bn extends $n{constructor(e,t,n,r){super(e,t,n),this.username=r}}class Jn extends $n{constructor(e,t){super(e,"facebook.com",t)}}class Yn extends Bn{constructor(e,t){super(e,"github.com",t,'string'==typeof t?.login?t?.login:null)}}class Xn extends $n{constructor(e,t){super(e,"google.com",t)}}class Qn extends Bn{constructor(e,t,n){super(e,"twitter.com",t,n)}}function Zn(e){const{user:t,_tokenResponse:n}=e;return t.isAnonymous&&!n?{providerId:null,isNewUser:!1,profile:null}:Kn(n)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function er(e,t){return(0,f.getModularInstance)(e).setPersistence(t)}function tr(e){return ft(e)}async function nr(e,t){return Ze(e).validatePassword(t)}function rr(e,t,n,r){return(0,f.getModularInstance)(e).onIdTokenChanged(t,n,r)}function ir(e,t,n){return(0,f.getModularInstance)(e).beforeAuthStateChanged(t,n)}function sr(e,t,n,r){return(0,f.getModularInstance)(e).onAuthStateChanged(t,n,r)}function or(e){(0,f.getModularInstance)(e).useDeviceLanguage()}function ar(e,t){return(0,f.getModularInstance)(e).updateCurrentUser(t)}function cr(e){return(0,f.getModularInstance)(e).signOut()}function ur(e,t){return Ze(e).revokeAccessToken(t)}async function dr(e){return(0,f.getModularInstance)(e).delete()}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class lr{constructor(e,t,n){this.type=e,this.credential=t,this.user=n}static _fromIdtoken(e,t){return new lr("enroll",e,t)}static _fromMfaPendingCredential(e){return new lr("signin",e)}toJSON(){const e="enroll"===this.type?'idToken':'pendingCredential';return{multiFactorSession:{[e]:this.credential}}}static fromJSON(e){if(e?.multiFactorSession){if(e.multiFactorSession?.pendingCredential)return lr._fromMfaPendingCredential(e.multiFactorSession.pendingCredential);if(e.multiFactorSession?.idToken)return lr._fromIdtoken(e.multiFactorSession.idToken)}return null}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class hr{constructor(e,t,n){this.session=e,this.hints=t,this.signInResolver=n}static _fromError(e,t){const n=Ze(e),r=t.customData._serverResponse,i=(r.mfaInfo||[]).map(e=>En._fromServerResponse(n,e));U(r.mfaPendingCredential,n,"internal-error");const s=lr._fromMfaPendingCredential(r.mfaPendingCredential);return new hr(s,i,async e=>{const i=await e._process(n,s);delete r.mfaInfo,delete r.mfaPendingCredential;const o=Object.assign({},r,{idToken:i.idToken,refreshToken:i.refreshToken});switch(t.operationType){case"signIn":const e=await on._fromIdTokenResponse(n,t.operationType,o);return await n._updateCurrentUser(e.user),e;case"reauthenticate":return U(t.user,n,"internal-error"),on._forOperation(t.user,t.operationType,o);default:R(n,"internal-error")}})}async resolveSignIn(e){const t=e;return this.signInResolver(t)}}function pr(e,t){const n=(0,f.getModularInstance)(e),r=t;return U(t.customData.operationType,n,"argument-error"),U(r.customData._serverResponse?.mfaPendingCredential,n,"argument-error"),hr._fromError(n,r)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function fr(e,t){return Y(e,"POST","/v2/accounts/mfaEnrollment:start",J(e,t))}function mr(e,t){return Y(e,"POST","/v2/accounts/mfaEnrollment:finalize",J(e,t))}function gr(e,t){return Y(e,"POST","/v2/accounts/mfaEnrollment:finalize",J(e,t))}class Ir{constructor(e){this.user=e,this.enrolledFactors=[],e._onReload(t=>{t.mfaInfo&&(this.enrolledFactors=t.mfaInfo.map(t=>En._fromServerResponse(e.auth,t)))})}static _fromUser(e){return new Ir(e)}async getSession(){return lr._fromIdtoken(await this.user.getIdToken(),this.user)}async enroll(e,t){const n=e,r=await this.getSession(),i=await Ie(this.user,n._process(this.user.auth,r,t));return await this.user._updateTokensIfNecessary(i),this.user.reload()}async unenroll(e){const t='string'==typeof e?e:e.uid,n=await this.user.getIdToken();try{const e=await Ie(this.user,(r=this.user.auth,i={idToken:n,mfaEnrollmentId:t},Y(r,"POST","/v2/accounts/mfaEnrollment:withdraw",J(r,i))));this.enrolledFactors=this.enrolledFactors.filter(({uid:e})=>e!==t),await this.user._updateTokensIfNecessary(e),await this.user.reload()}catch(e){throw e}var r,i}}const _r=new WeakMap;function yr(e){const t=(0,f.getModularInstance)(e);return _r.has(t)||_r.set(t,Ir._fromUser(t)),_r.get(t)}const vr='__sak';
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Tr{constructor(e,t){this.storageRetriever=e,this.type=t}_isAvailable(){try{return this.storage?(this.storage.setItem(vr,'1'),this.storage.removeItem(vr),Promise.resolve(!0)):Promise.resolve(!1)}catch{return Promise.resolve(!1)}}_set(e,t){return this.storage.setItem(e,JSON.stringify(t)),Promise.resolve()}_get(e){const t=this.storage.getItem(e);return Promise.resolve(t?JSON.parse(t):null)}_remove(e){return this.storage.removeItem(e),Promise.resolve()}get storage(){return this.storageRetriever()}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Er extends Tr{constructor(){super(()=>window.localStorage,"LOCAL"),this.boundEventHandler=(e,t)=>this.onStorageEvent(e,t),this.listeners={},this.localCache={},this.pollTimer=null,this.fallbackToPolling=$e(),this._shouldAllowMigration=!0}forAllChangedKeys(e){for(const t of Object.keys(this.listeners)){const n=this.storage.getItem(t),r=this.localCache[t];n!==r&&e(t,r,n)}}onStorageEvent(e,t=!1){if(!e.key)return void this.forAllChangedKeys((e,t,n)=>{this.notifyListeners(e,n)});const n=e.key;t?this.detachListener():this.stopPolling();const r=()=>{const e=this.storage.getItem(n);(t||this.localCache[n]!==e)&&this.notifyListeners(n,e)},i=this.storage.getItem(n);(0,f.isIE)()&&10===document.documentMode&&i!==e.newValue&&e.newValue!==e.oldValue?setTimeout(r,10):r()}notifyListeners(e,t){this.localCache[e]=t;const n=this.listeners[e];if(n)for(const e of Array.from(n))e(t?JSON.parse(t):t)}startPolling(){this.stopPolling(),this.pollTimer=setInterval(()=>{this.forAllChangedKeys((e,t,n)=>{this.onStorageEvent(new StorageEvent('storage',{key:e,oldValue:t,newValue:n}),!0)})},1e3)}stopPolling(){this.pollTimer&&(clearInterval(this.pollTimer),this.pollTimer=null)}attachListener(){window.addEventListener('storage',this.boundEventHandler)}detachListener(){window.removeEventListener('storage',this.boundEventHandler)}_addListener(e,t){0===Object.keys(this.listeners).length&&(this.fallbackToPolling?this.startPolling():this.attachListener()),this.listeners[e]||(this.listeners[e]=new Set,this.localCache[e]=this.storage.getItem(e)),this.listeners[e].add(t)}_removeListener(e,t){this.listeners[e]&&(this.listeners[e].delete(t),0===this.listeners[e].size&&delete this.listeners[e]),0===Object.keys(this.listeners).length&&(this.detachListener(),this.stopPolling())}async _set(e,t){await super._set(e,t),this.localCache[e]=JSON.stringify(t)}async _get(e){const t=await super._get(e);return this.localCache[e]=JSON.stringify(t),t}async _remove(e){await super._remove(e),delete this.localCache[e]}}Er.type='LOCAL';const wr=Er;
/**
   * @license
   * Copyright 2025 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function br(e){const t=e.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&'),n=RegExp(`${t}=([^;]+)`);return document.cookie.match(n)?.[1]??null}function Pr(e){return`${'http:'===window.location.protocol?'__dev_':'__HOST-'}FIREBASE_${e.split(':')[3]}`}class Ar{constructor(){this.type="COOKIE",this.listenerUnsubscribes=new Map}_getFinalTarget(e){if(void 0===typeof window)return e;const t=new URL(`${window.location.origin}/__cookies__`);return t.searchParams.set('finalTarget',e),t}async _isAvailable(){return!('boolean'==typeof isSecureContext&&!isSecureContext)&&('undefined'!=typeof navigator&&'undefined'!=typeof document&&(navigator.cookieEnabled??!0))}async _set(e,t){}async _get(e){if(!this._isAvailable())return null;const t=Pr(e);if(window.cookieStore){const e=await window.cookieStore.get(t);return e?.value}return br(t)}async _remove(e){if(!this._isAvailable())return;if(!await this._get(e))return;const t=Pr(e);document.cookie=`${t}=;Max-Age=34560000;Partitioned;Secure;SameSite=Strict;Path=/;Priority=High`,await fetch("/__cookies__",{method:'DELETE'}).catch(()=>{})}_addListener(e,t){if(!this._isAvailable())return;const n=Pr(e);if(window.cookieStore){const e=e=>{const r=e.changed.find(e=>e.name===n);r&&t(r.value);e.deleted.find(e=>e.name===n)&&t(null)},r=()=>window.cookieStore.removeEventListener('change',e);return this.listenerUnsubscribes.set(t,r),window.cookieStore.addEventListener('change',e)}let r=br(n);const i=setInterval(()=>{const e=br(n);e!==r&&(t(e),r=e)},1e3);this.listenerUnsubscribes.set(t,()=>clearInterval(i))}_removeListener(e,t){const n=this.listenerUnsubscribes.get(t);n&&(n(),this.listenerUnsubscribes.delete(t))}}Ar.type='COOKIE';const Sr=Ar;
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Or extends Tr{constructor(){super(()=>window.sessionStorage,"SESSION")}_addListener(e,t){}_removeListener(e,t){}}Or.type='SESSION';const kr=Or;
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Rr(e){return Promise.all(e.map(async e=>{try{return{fulfilled:!0,value:await e}}catch(e){return{fulfilled:!1,reason:e}}}))}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Nr{constructor(e){this.eventTarget=e,this.handlersMap={},this.boundEventHandler=this.handleEvent.bind(this)}static _getInstance(e){const t=this.receivers.find(t=>t.isListeningto(e));if(t)return t;const n=new Nr(e);return this.receivers.push(n),n}isListeningto(e){return this.eventTarget===e}async handleEvent(e){const t=e,{eventId:n,eventType:r,data:i}=t.data,s=this.handlersMap[r];if(!s?.size)return;t.ports[0].postMessage({status:"ack",eventId:n,eventType:r});const o=Array.from(s).map(async e=>e(t.origin,i)),a=await Rr(o);t.ports[0].postMessage({status:"done",eventId:n,eventType:r,response:a})}_subscribe(e,t){0===Object.keys(this.handlersMap).length&&this.eventTarget.addEventListener('message',this.boundEventHandler),this.handlersMap[e]||(this.handlersMap[e]=new Set),this.handlersMap[e].add(t)}_unsubscribe(e,t){this.handlersMap[e]&&t&&this.handlersMap[e].delete(t),t&&0!==this.handlersMap[e].size||delete this.handlersMap[e],0===Object.keys(this.handlersMap).length&&this.eventTarget.removeEventListener('message',this.boundEventHandler)}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
function Cr(e="",t=10){let n='';for(let e=0;e<t;e++)n+=Math.floor(10*Math.random());return e+n}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */Nr.receivers=[];class Dr{constructor(e){this.target=e,this.handlers=new Set}removeMessageHandler(e){e.messageChannel&&(e.messageChannel.port1.removeEventListener('message',e.onMessage),e.messageChannel.port1.close()),this.handlers.delete(e)}async _send(e,t,n=50){const r='undefined'!=typeof MessageChannel?new MessageChannel:null;if(!r)throw new Error("connection_unavailable");let i,s;return new Promise((o,a)=>{const c=Cr('',20);r.port1.start();const u=setTimeout(()=>{a(new Error("unsupported_event"))},n);s={messageChannel:r,onMessage(e){const t=e;if(t.data.eventId===c)switch(t.data.status){case"ack":clearTimeout(u),i=setTimeout(()=>{a(new Error("timeout"))},3e3);break;case"done":clearTimeout(i),o(t.data.response);break;default:clearTimeout(u),clearTimeout(i),a(new Error("invalid_response"))}}},this.handlers.add(s),r.port1.addEventListener('message',s.onMessage),this.target.postMessage({eventType:e,eventId:c,data:t},[r.port2])}).finally(()=>{s&&this.removeMessageHandler(s)})}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Lr(){return window}function Mr(e){Lr().location.href=e}
/**
   * @license
   * Copyright 2020 Google LLC.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Ur(){return void 0!==Lr().WorkerGlobalScope&&'function'==typeof Lr().importScripts}async function jr(){if(!navigator?.serviceWorker)return null;try{return(await navigator.serviceWorker.ready).active}catch{return null}}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
const Fr='firebaseLocalStorageDb',Vr='firebaseLocalStorage',xr='fbase_key';class Hr{constructor(e){this.request=e}toPromise(){return new Promise((e,t)=>{this.request.addEventListener('success',()=>{e(this.request.result)}),this.request.addEventListener('error',()=>{t(this.request.error)})})}}function qr(e,t){return e.transaction([Vr],t?'readwrite':'readonly').objectStore(Vr)}function Wr(){const e=indexedDB.deleteDatabase(Fr);return new Hr(e).toPromise()}function zr(){const e=indexedDB.open(Fr,1);return new Promise((t,n)=>{e.addEventListener('error',()=>{n(e.error)}),e.addEventListener('upgradeneeded',()=>{const t=e.result;try{t.createObjectStore(Vr,{keyPath:xr})}catch(e){n(e)}}),e.addEventListener('success',async()=>{const n=e.result;n.objectStoreNames.contains(Vr)?t(n):(n.close(),await Wr(),t(await zr()))})})}async function Gr(e,t,n){const r=qr(e,!0).put({[xr]:t,value:n});return new Hr(r).toPromise()}async function Kr(e,t){const n=qr(e,!1).get(t),r=await new Hr(n).toPromise();return void 0===r?null:r.value}function $r(e,t){const n=qr(e,!0).delete(t);return new Hr(n).toPromise()}class Br{constructor(){this.type="LOCAL",this._shouldAllowMigration=!0,this.listeners={},this.localCache={},this.pollTimer=null,this.pendingWrites=0,this.receiver=null,this.sender=null,this.serviceWorkerReceiverAvailable=!1,this.activeServiceWorker=null,this._workerInitializationPromise=this.initializeServiceWorkerMessaging().then(()=>{},()=>{})}async _openDb(){return this.db||(this.db=await zr()),this.db}async _withRetries(e){let t=0;for(;;)try{const t=await this._openDb();return await e(t)}catch(e){if(t++>3)throw e;this.db&&(this.db.close(),this.db=void 0)}}async initializeServiceWorkerMessaging(){return Ur()?this.initializeReceiver():this.initializeSender()}async initializeReceiver(){this.receiver=Nr._getInstance(Ur()?self:null),this.receiver._subscribe("keyChanged",async(e,t)=>({keyProcessed:(await this._poll()).includes(t.key)})),this.receiver._subscribe("ping",async(e,t)=>["keyChanged"])}async initializeSender(){if(this.activeServiceWorker=await jr(),!this.activeServiceWorker)return;this.sender=new Dr(this.activeServiceWorker);const e=await this.sender._send("ping",{},800);e&&e[0]?.fulfilled&&e[0]?.value.includes("keyChanged")&&(this.serviceWorkerReceiverAvailable=!0)}async notifyServiceWorker(e){if(this.sender&&this.activeServiceWorker&&(navigator?.serviceWorker?.controller||null)===this.activeServiceWorker)try{await this.sender._send("keyChanged",{key:e},this.serviceWorkerReceiverAvailable?800:50)}catch{}}async _isAvailable(){try{if(!indexedDB)return!1;const e=await zr();return await Gr(e,vr,'1'),await $r(e,vr),!0}catch{}return!1}async _withPendingWrite(e){this.pendingWrites++;try{await e()}finally{this.pendingWrites--}}async _set(e,t){return this._withPendingWrite(async()=>(await this._withRetries(n=>Gr(n,e,t)),this.localCache[e]=t,this.notifyServiceWorker(e)))}async _get(e){const t=await this._withRetries(t=>Kr(t,e));return this.localCache[e]=t,t}async _remove(e){return this._withPendingWrite(async()=>(await this._withRetries(t=>$r(t,e)),delete this.localCache[e],this.notifyServiceWorker(e)))}async _poll(){const e=await this._withRetries(e=>{const t=qr(e,!1).getAll();return new Hr(t).toPromise()});if(!e)return[];if(0!==this.pendingWrites)return[];const t=[],n=new Set;if(0!==e.length)for(const{fbase_key:r,value:i}of e)n.add(r),JSON.stringify(this.localCache[r])!==JSON.stringify(i)&&(this.notifyListeners(r,i),t.push(r));for(const e of Object.keys(this.localCache))this.localCache[e]&&!n.has(e)&&(this.notifyListeners(e,null),t.push(e));return t}notifyListeners(e,t){this.localCache[e]=t;const n=this.listeners[e];if(n)for(const e of Array.from(n))e(t)}startPolling(){this.stopPolling(),this.pollTimer=setInterval(async()=>this._poll(),800)}stopPolling(){this.pollTimer&&(clearInterval(this.pollTimer),this.pollTimer=null)}_addListener(e,t){0===Object.keys(this.listeners).length&&this.startPolling(),this.listeners[e]||(this.listeners[e]=new Set,this._get(e)),this.listeners[e].add(t)}_removeListener(e,t){this.listeners[e]&&(this.listeners[e].delete(t),0===this.listeners[e].size&&delete this.listeners[e]),0===Object.keys(this.listeners).length&&this.stopPolling()}}Br.type='LOCAL';const Jr=Br;
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Yr(e,t){return Y(e,"POST","/v2/accounts/mfaSignIn:start",J(e,t))}function Xr(e,t){return Y(e,"POST","/v2/accounts/mfaSignIn:finalize",J(e,t))}function Qr(e,t){return Y(e,"POST","/v2/accounts/mfaSignIn:finalize",J(e,t))}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const Zr=rt('rcb'),ei=new W(3e4,6e4);class ti{constructor(){this.hostLanguage='',this.counter=0,this.librarySeparatelyLoaded=!!Lr().grecaptcha?.render}load(e,t=""){return U(ni(t),e,"argument-error"),this.shouldResolveImmediately(t)&&re(Lr().grecaptcha)?Promise.resolve(Lr().grecaptcha):new Promise((n,r)=>{const i=Lr().setTimeout(()=>{r(N(e,"network-request-failed"))},ei.get());Lr()[Zr]=()=>{Lr().clearTimeout(i),delete Lr()[Zr];const s=Lr().grecaptcha;if(!s||!re(s))return void r(N(e,"internal-error"));const o=s.render;s.render=(e,t)=>{const n=o(e,t);return this.counter++,n},this.hostLanguage=t,n(s)};nt(`${tt.recaptchaV2Script}?${(0,f.querystring)({onload:Zr,render:'explicit',hl:t})}`).catch(()=>{clearTimeout(i),r(N(e,"internal-error"))})})}clearedOneInstance(){this.counter--}shouldResolveImmediately(e){return!!Lr().grecaptcha?.render&&(e===this.hostLanguage||this.counter>0||this.librarySeparatelyLoaded)}}function ni(e){return e.length<=6&&/^\s*[a-zA-Z0-9\-]*\s*$/.test(e)}class ri{async load(e){return new st(e)}clearedOneInstance(){}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const ii='recaptcha',si={theme:'light',type:'image'};class oi{constructor(e,t,n=Object.assign({},si)){this.parameters=n,this.type=ii,this.destroyed=!1,this.widgetId=null,this.tokenChangeListeners=new Set,this.renderPromise=null,this.recaptcha=null,this.auth=Ze(e),this.isInvisible='invisible'===this.parameters.size,U('undefined'!=typeof document,this.auth,"operation-not-supported-in-this-environment");const r='string'==typeof t?document.getElementById(t):t;U(r,this.auth,"argument-error"),this.container=r,this.parameters.callback=this.makeTokenCallback(this.parameters.callback),this._recaptchaLoader=this.auth.settings.appVerificationDisabledForTesting?new ri:new ti,this.validateStartingState()}async verify(){this.assertNotDestroyed();const e=await this.render(),t=this.getAssertedRecaptcha(),n=t.getResponse(e);return n||new Promise(n=>{const r=e=>{e&&(this.tokenChangeListeners.delete(r),n(e))};this.tokenChangeListeners.add(r),this.isInvisible&&t.execute(e)})}render(){try{this.assertNotDestroyed()}catch(e){return Promise.reject(e)}return this.renderPromise||(this.renderPromise=this.makeRenderPromise().catch(e=>{throw this.renderPromise=null,e})),this.renderPromise}_reset(){this.assertNotDestroyed(),null!==this.widgetId&&this.getAssertedRecaptcha().reset(this.widgetId)}clear(){this.assertNotDestroyed(),this.destroyed=!0,this._recaptchaLoader.clearedOneInstance(),this.isInvisible||this.container.childNodes.forEach(e=>{this.container.removeChild(e)})}validateStartingState(){U(!this.parameters.sitekey,this.auth,"argument-error"),U(this.isInvisible||!this.container.hasChildNodes(),this.auth,"argument-error"),U('undefined'!=typeof document,this.auth,"operation-not-supported-in-this-environment")}makeTokenCallback(e){return t=>{if(this.tokenChangeListeners.forEach(e=>e(t)),'function'==typeof e)e(t);else if('string'==typeof e){const n=Lr()[e];'function'==typeof n&&n(t)}}}assertNotDestroyed(){U(!this.destroyed,this.auth,"internal-error")}async makeRenderPromise(){if(await this.init(),!this.widgetId){let e=this.container;if(!this.isInvisible){const t=document.createElement('div');e.appendChild(t),e=t}this.widgetId=this.getAssertedRecaptcha().render(e,this.parameters)}return this.widgetId}async init(){U(x()&&!Ur(),this.auth,"internal-error"),await ai(),this.recaptcha=await this._recaptchaLoader.load(this.auth,this.auth.languageCode||void 0);const e=await oe(this.auth);U(e,this.auth,"internal-error"),this.parameters.sitekey=e}getAssertedRecaptcha(){return U(this.recaptcha,this.auth,"internal-error"),this.recaptcha}}function ai(){let e=null;return new Promise(t=>{'complete'!==document.readyState?(e=()=>t(),window.addEventListener('load',e)):t()}).catch(t=>{throw e&&window.removeEventListener('load',e),t})}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class ci{constructor(e,t){this.verificationId=e,this.onConfirmation=t}confirm(e){const t=Wt._fromVerification(this.verificationId,e);return this.onConfirmation(t)}}async function ui(e,t,n){if((0,p._isFirebaseServerApp)(e.app))return Promise.reject(D(e));const r=Ze(e),i=await hi(r,t,(0,f.getModularInstance)(n));return new ci(i,e=>In(r,e))}async function di(e,t,n){const r=(0,f.getModularInstance)(e);await fn(!1,r,"phone");const i=await hi(r.auth,t,(0,f.getModularInstance)(n));return new ci(i,e=>_n(r,e))}async function li(e,t,n){const r=(0,f.getModularInstance)(e);if((0,p._isFirebaseServerApp)(r.auth.app))return Promise.reject(D(r.auth));const i=await hi(r.auth,t,(0,f.getModularInstance)(n));return new ci(i,e=>yn(r,e))}async function hi(e,t,n){if(!e._getRecaptchaConfig())try{await ft(e)}catch(e){console.log('Failed to initialize reCAPTCHA Enterprise config. Triggering the reCAPTCHA v2 verification.')}try{let r;if(r='string'==typeof t?{phoneNumber:t}:t,'session'in r){const t=r.session;if('phoneNumber'in r){U("enroll"===t.type,e,"internal-error");const i={idToken:t.credential,phoneEnrollmentInfo:{phoneNumber:r.phoneNumber,clientType:"CLIENT_TYPE_WEB"}},s=pt(e,i,"mfaSmsEnrollment",async(e,t)=>{if(t.phoneEnrollmentInfo.captchaResponse===dt){U(n?.type===ii,e,"argument-error");return fr(e,await fi(e,t,n))}return fr(e,t)},"PHONE_PROVIDER");return(await s.catch(e=>Promise.reject(e))).phoneSessionInfo.sessionInfo}{U("signin"===t.type,e,"internal-error");const i=r.multiFactorHint?.uid||r.multiFactorUid;U(i,e,"missing-multi-factor-info");const s={mfaPendingCredential:t.credential,mfaEnrollmentId:i,phoneSignInInfo:{clientType:"CLIENT_TYPE_WEB"}},o=pt(e,s,"mfaSmsSignIn",async(e,t)=>{if(t.phoneSignInInfo.captchaResponse===dt){U(n?.type===ii,e,"argument-error");return Yr(e,await fi(e,t,n))}return Yr(e,t)},"PHONE_PROVIDER");return(await o.catch(e=>Promise.reject(e))).phoneResponseInfo.sessionInfo}}{const t={phoneNumber:r.phoneNumber,clientType:"CLIENT_TYPE_WEB"},i=pt(e,t,"sendVerificationCode",async(e,t)=>{if(t.captchaResponse===dt){U(n?.type===ii,e,"argument-error");return Ft(e,await fi(e,t,n))}return Ft(e,t)},"PHONE_PROVIDER");return(await i.catch(e=>Promise.reject(e))).sessionInfo}}finally{n?._reset()}}async function pi(e,t){const n=(0,f.getModularInstance)(e);if((0,p._isFirebaseServerApp)(n.auth.app))return Promise.reject(D(n.auth));await pn(n,t)}async function fi(e,t,n){U(n.type===ii,e,"argument-error");const r=await n.verify();U('string'==typeof r,e,"argument-error");const i=Object.assign({},t);if('phoneEnrollmentInfo'in i){const e=i.phoneEnrollmentInfo.phoneNumber,t=i.phoneEnrollmentInfo.captchaResponse,n=i.phoneEnrollmentInfo.clientType,s=i.phoneEnrollmentInfo.recaptchaVersion;return Object.assign(i,{phoneEnrollmentInfo:{phoneNumber:e,recaptchaToken:r,captchaResponse:t,clientType:n,recaptchaVersion:s}}),i}if('phoneSignInInfo'in i){const e=i.phoneSignInInfo.captchaResponse,t=i.phoneSignInInfo.clientType,n=i.phoneSignInInfo.recaptchaVersion;return Object.assign(i,{phoneSignInInfo:{recaptchaToken:r,captchaResponse:e,clientType:t,recaptchaVersion:n}}),i}return Object.assign(i,{recaptchaToken:r}),i}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class mi{constructor(e){this.providerId=mi.PROVIDER_ID,this.auth=Ze(e)}verifyPhoneNumber(e,t){return hi(this.auth,e,(0,f.getModularInstance)(t))}static credential(e,t){return Wt._fromVerification(e,t)}static credentialFromResult(e){const t=e;return mi.credentialFromTaggedObject(t)}static credentialFromError(e){return mi.credentialFromTaggedObject(e.customData||{})}static credentialFromTaggedObject({_tokenResponse:e}){if(!e)return null;const{phoneNumber:t,temporaryProof:n}=e;return t&&n?Wt._fromTokenResponse(t,n):null}}
/**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
function gi(e,t){return t?Ne(t):(U(e._popupRedirectResolver,e,"argument-error"),e._popupRedirectResolver)}
/**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */mi.PROVIDER_ID="phone",mi.PHONE_SIGN_IN_METHOD="phone";class Ii extends Et{constructor(e){super("custom","custom"),this.params=e}_getIdTokenResponse(e){return Ut(e,this._buildIdpRequest())}_linkToIdToken(e,t){return Ut(e,this._buildIdpRequest(t))}_getReauthenticationResolver(e){return Ut(e,this._buildIdpRequest())}_buildIdpRequest(e){const t={requestUri:this.params.requestUri,sessionId:this.params.sessionId,postBody:this.params.postBody,tenantId:this.params.tenantId,pendingToken:this.params.pendingToken,returnSecureToken:!0,returnIdpCredential:!0};return e&&(t.idToken=e),t}}function _i(e){return gn(e.auth,new Ii(e),e.bypassAuthState)}function yi(e){const{auth:t,user:n}=e;return U(n,t,"internal-error"),mn(n,new Ii(e),e.bypassAuthState)}async function vi(e){const{auth:t,user:n}=e;return U(n,t,"internal-error"),pn(n,new Ii(e),e.bypassAuthState)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Ti{constructor(e,t,n,r,i=!1){this.auth=e,this.resolver=n,this.user=r,this.bypassAuthState=i,this.pendingPromise=null,this.eventManager=null,this.filter=Array.isArray(t)?t:[t]}execute(){return new Promise(async(e,t)=>{this.pendingPromise={resolve:e,reject:t};try{this.eventManager=await this.resolver._initialize(this.auth),await this.onExecution(),this.eventManager.registerConsumer(this)}catch(e){this.reject(e)}})}async onAuthEvent(e){const{urlResponse:t,sessionId:n,postBody:r,tenantId:i,error:s,type:o}=e;if(s)return void this.reject(s);const a={auth:this.auth,requestUri:t,sessionId:n,tenantId:i||void 0,postBody:r||void 0,user:this.user,bypassAuthState:this.bypassAuthState};try{this.resolve(await this.getIdpTask(o)(a))}catch(e){this.reject(e)}}onError(e){this.reject(e)}getIdpTask(e){switch(e){case"signInViaPopup":case"signInViaRedirect":return _i;case"linkViaPopup":case"linkViaRedirect":return vi;case"reauthViaPopup":case"reauthViaRedirect":return yi;default:R(this.auth,"internal-error")}}resolve(e){F(this.pendingPromise,'Pending promise was never set'),this.pendingPromise.resolve(e),this.unregisterAndCleanUp()}reject(e){F(this.pendingPromise,'Pending promise was never set'),this.pendingPromise.reject(e),this.unregisterAndCleanUp()}unregisterAndCleanUp(){this.eventManager&&this.eventManager.unregisterConsumer(this),this.pendingPromise=null,this.cleanUp()}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const Ei=new W(2e3,1e4);async function wi(e,t,n){if((0,p._isFirebaseServerApp)(e.app))return Promise.reject(N(e,"operation-not-supported-in-this-environment"));const r=Ze(e);L(e,t,Jt);const i=gi(r,n);return new Ai(r,"signInViaPopup",t,i).executeNotNull()}async function bi(e,t,n){const r=(0,f.getModularInstance)(e);if((0,p._isFirebaseServerApp)(r.auth.app))return Promise.reject(N(r.auth,"operation-not-supported-in-this-environment"));L(r.auth,t,Jt);const i=gi(r.auth,n);return new Ai(r.auth,"reauthViaPopup",t,i,r).executeNotNull()}async function Pi(e,t,n){const r=(0,f.getModularInstance)(e);L(r.auth,t,Jt);const i=gi(r.auth,n);return new Ai(r.auth,"linkViaPopup",t,i,r).executeNotNull()}class Ai extends Ti{constructor(e,t,n,r,i){super(e,t,r,i),this.provider=n,this.authWindow=null,this.pollId=null,Ai.currentPopupAction&&Ai.currentPopupAction.cancel(),Ai.currentPopupAction=this}async executeNotNull(){const e=await this.execute();return U(e,this.auth,"internal-error"),e}async onExecution(){F(1===this.filter.length,'Popup operations only handle one event');const e=Cr();this.authWindow=await this.resolver._openPopup(this.auth,this.provider,this.filter[0],e),this.authWindow.associatedEvent=e,this.resolver._originValidation(this.auth).catch(e=>{this.reject(e)}),this.resolver._isIframeWebStorageSupported(this.auth,e=>{e||this.reject(N(this.auth,"web-storage-unsupported"))}),this.pollUserCancellation()}get eventId(){return this.authWindow?.associatedEvent||null}cancel(){this.reject(N(this.auth,"cancelled-popup-request"))}cleanUp(){this.authWindow&&this.authWindow.close(),this.pollId&&window.clearTimeout(this.pollId),this.authWindow=null,this.pollId=null,Ai.currentPopupAction=null}pollUserCancellation(){const e=()=>{this.authWindow?.window?.closed?this.pollId=window.setTimeout(()=>{this.pollId=null,this.reject(N(this.auth,"popup-closed-by-user"))},8e3):this.pollId=window.setTimeout(e,Ei.get())};e()}}Ai.currentPopupAction=null;
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
const Si='pendingRedirect',Oi=new Map;class ki extends Ti{constructor(e,t,n=!1){super(e,["signInViaRedirect","linkViaRedirect","reauthViaRedirect","unknown"],t,void 0,n),this.eventId=null}async execute(){let e=Oi.get(this.auth._key());if(!e){try{const t=await Ri(this.resolver,this.auth)?await super.execute():null;e=()=>Promise.resolve(t)}catch(t){e=()=>Promise.reject(t)}Oi.set(this.auth._key(),e)}return this.bypassAuthState||Oi.set(this.auth._key(),()=>Promise.resolve(null)),e()}async onAuthEvent(e){if("signInViaRedirect"===e.type)return super.onAuthEvent(e);if("unknown"!==e.type){if(e.eventId){const t=await this.auth._redirectUserForId(e.eventId);if(t)return this.user=t,super.onAuthEvent(e);this.resolve(null)}}else this.resolve(null)}async onExecution(){}cleanUp(){}}async function Ri(e,t){const n=Mi(t),r=Li(e);if(!await r._isAvailable())return!1;const i='true'===await r._get(n);return await r._remove(n),i}async function Ni(e,t){return Li(e)._set(Mi(t),'true')}function Ci(){Oi.clear()}function Di(e,t){Oi.set(e._key(),t)}function Li(e){return Ne(e._redirectPersistence)}function Mi(e){return Le(Si,e.config.apiKey,e.name)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Ui(e,t,n){return ji(e,t,n)}async function ji(e,t,n){if((0,p._isFirebaseServerApp)(e.app))return Promise.reject(D(e));const r=Ze(e);L(e,t,Jt),await r._initializationPromise;const i=gi(r,n);return await Ni(i,r),i._openRedirect(r,t,"signInViaRedirect")}function Fi(e,t,n){return Vi(e,t,n)}async function Vi(e,t,n){const r=(0,f.getModularInstance)(e);if(L(r.auth,t,Jt),(0,p._isFirebaseServerApp)(r.auth.app))return Promise.reject(D(r.auth));await r.auth._initializationPromise;const i=gi(r.auth,n);await Ni(i,r.auth);const s=await zi(r);return i._openRedirect(r.auth,t,"reauthViaRedirect",s)}function xi(e,t,n){return Hi(e,t,n)}async function Hi(e,t,n){const r=(0,f.getModularInstance)(e);L(r.auth,t,Jt),await r.auth._initializationPromise;const i=gi(r.auth,n);await fn(!1,r,t.providerId),await Ni(i,r.auth);const s=await zi(r);return i._openRedirect(r.auth,t,"linkViaRedirect",s)}async function qi(e,t){return await Ze(e)._initializationPromise,Wi(e,t,!1)}async function Wi(e,t,n=!1){if((0,p._isFirebaseServerApp)(e.app))return Promise.reject(D(e));const r=Ze(e),i=gi(r,t),s=new ki(r,i,n),o=await s.execute();return o&&!n&&(delete o.user._redirectEventId,await r._persistUserIfCurrent(o.user),await r._setRedirectUser(null,t)),o}async function zi(e){const t=Cr(`${e.uid}:::`);return e._redirectEventId=t,await e.auth._setRedirectUser(e),await e.auth._persistUserIfCurrent(e),t}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class Gi{constructor(e){this.auth=e,this.cachedEventUids=new Set,this.consumers=new Set,this.queuedRedirectEvent=null,this.hasHandledPotentialRedirect=!1,this.lastProcessedEventTime=Date.now()}registerConsumer(e){this.consumers.add(e),this.queuedRedirectEvent&&this.isEventForConsumer(this.queuedRedirectEvent,e)&&(this.sendToConsumer(this.queuedRedirectEvent,e),this.saveEventToCache(this.queuedRedirectEvent),this.queuedRedirectEvent=null)}unregisterConsumer(e){this.consumers.delete(e)}onEvent(e){if(this.hasEventBeenHandled(e))return!1;let t=!1;return this.consumers.forEach(n=>{this.isEventForConsumer(e,n)&&(t=!0,this.sendToConsumer(e,n),this.saveEventToCache(e))}),this.hasHandledPotentialRedirect||!Bi(e)||(this.hasHandledPotentialRedirect=!0,t||(this.queuedRedirectEvent=e,t=!0)),t}sendToConsumer(e,t){if(e.error&&!$i(e)){const n=e.error.code?.split('auth/')[1]||"internal-error";t.onError(N(this.auth,n))}else t.onAuthEvent(e)}isEventForConsumer(e,t){const n=null===t.eventId||!!e.eventId&&e.eventId===t.eventId;return t.filter.includes(e.type)&&n}hasEventBeenHandled(e){return Date.now()-this.lastProcessedEventTime>=6e5&&this.cachedEventUids.clear(),this.cachedEventUids.has(Ki(e))}saveEventToCache(e){this.cachedEventUids.add(Ki(e)),this.lastProcessedEventTime=Date.now()}}function Ki(e){return[e.type,e.eventId,e.sessionId,e.tenantId].filter(e=>e).join('-')}function $i({type:e,error:t}){return"unknown"===e&&"auth/no-auth-event"===t?.code}function Bi(e){switch(e.type){case"signInViaRedirect":case"linkViaRedirect":case"reauthViaRedirect":return!0;case"unknown":return $i(e);default:return!1}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function Ji(e,t={}){return Y(e,"GET","/v1/projects",t)}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const Yi=/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,Xi=/^https?/;async function Qi(e){if(e.config.emulator)return;const{authorizedDomains:t}=await Ji(e);for(const e of t)try{if(Zi(e))return}catch{}R(e,"unauthorized-domain")}function Zi(e){const t=V(),{protocol:n,hostname:r}=new URL(t);if(e.startsWith('chrome-extension://')){const i=new URL(e);return''===i.hostname&&''===r?'chrome-extension:'===n&&e.replace('chrome-extension://','')===t.replace('chrome-extension://',''):'chrome-extension:'===n&&i.hostname===r}if(!Xi.test(n))return!1;if(Yi.test(e))return r===e;const i=e.replace(/\./g,'\\.');return new RegExp('^(.+\\.'+i+'|'+i+')$','i').test(r)}
/**
   * @license
   * Copyright 2020 Google LLC.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const es=new W(3e4,6e4);function ts(){const e=Lr().___jsl;if(e?.H)for(const t of Object.keys(e.H))if(e.H[t].r=e.H[t].r||[],e.H[t].L=e.H[t].L||[],e.H[t].r=[...e.H[t].L],e.CP)for(let t=0;t<e.CP.length;t++)e.CP[t]=null}function ns(e){return new Promise((t,n)=>{function r(){ts(),gapi.load('gapi.iframes',{callback:()=>{t(gapi.iframes.getContext())},ontimeout:()=>{ts(),n(N(e,"network-request-failed"))},timeout:es.get()})}if(Lr().gapi?.iframes?.Iframe)t(gapi.iframes.getContext());else{if(!Lr().gapi?.load){const t=rt('iframefcb');return Lr()[t]=()=>{gapi.load?r():n(N(e,"network-request-failed"))},nt(`${tt.gapiScript}?onload=${t}`).catch(e=>n(e))}r()}}).catch(e=>{throw rs=null,e})}let rs=null;function is(e){return rs=rs||ns(e),rs}
/**
   * @license
   * Copyright 2020 Google LLC.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const ss=new W(5e3,15e3),os={style:{position:'absolute',top:'-100px',width:'1px',height:'1px'},'aria-hidden':'true',tabindex:'-1'},as=new Map([["identitytoolkit.googleapis.com",'p'],['staging-identitytoolkit.sandbox.googleapis.com','s'],['test-identitytoolkit.sandbox.googleapis.com','t']]);function cs(e){const t=e.config;U(t.authDomain,e,"auth-domain-config-required");const n=t.emulator?z(t,"emulator/auth/iframe"):`https://${e.config.authDomain}/__/auth/iframe`,r={apiKey:t.apiKey,appName:e.name,v:p.SDK_VERSION},i=as.get(e.config.apiHost);i&&(r.eid=i);const s=e._getFrameworks();return s.length&&(r.fw=s.join(',')),`${n}?${(0,f.querystring)(r).slice(1)}`}async function us(e){const t=await is(e),n=Lr().gapi;return U(n,e,"internal-error"),t.open({where:document.body,url:cs(e),messageHandlersFilter:n.iframes.CROSS_ORIGIN_IFRAMES_FILTER,attributes:os,dontclear:!0},t=>new Promise(async(n,r)=>{await t.restyle({setHideOnLeave:!1});const i=N(e,"network-request-failed"),s=Lr().setTimeout(()=>{r(i)},ss.get());function o(){Lr().clearTimeout(s),n(t)}t.ping(o).then(o,()=>{r(i)})}))}
/**
   * @license
   * Copyright 2020 Google LLC.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const ds={location:'yes',resizable:'yes',statusbar:'yes',toolbar:'no'};class ls{constructor(e){this.window=e,this.associatedEvent=null}close(){if(this.window)try{this.window.close()}catch(e){}}}function hs(e,t,n,r=500,i=600){const s=Math.max((window.screen.availHeight-i)/2,0).toString(),o=Math.max((window.screen.availWidth-r)/2,0).toString();let a='';const c=Object.assign({},ds,{width:r.toString(),height:i.toString(),top:s,left:o}),u=(0,f.getUA)().toLowerCase();n&&(a=Ve(u)?"_blank":n),je(u)&&(t=t||"http://localhost",c.scrollbars='yes');const d=Object.entries(c).reduce((e,[t,n])=>`${e}${t}=${n},`,'');if(Ke(u)&&'_self'!==a)return ps(t||'',a),new ls(null);const l=window.open(t||'',a,d);U(l,e,"popup-blocked");try{l.focus()}catch(e){}return new ls(l)}function ps(e,t){const n=document.createElement('a');n.href=e,n.target=t;const r=document.createEvent('MouseEvent');r.initMouseEvent('click',!0,!0,window,1,0,0,0,0,!1,!1,!1,!1,1,null),n.dispatchEvent(r)}
/**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const fs='__/auth/handler',ms='emulator/auth/handler',gs=encodeURIComponent('fac');async function Is(e,t,n,r,i,s){U(e.config.authDomain,e,"auth-domain-config-required"),U(e.config.apiKey,e,"invalid-api-key");const o={apiKey:e.config.apiKey,appName:e.name,authType:n,redirectUrl:r,v:p.SDK_VERSION,eventId:i};if(t instanceof Jt){t.setDefaultLanguage(e.languageCode),o.providerId=t.providerId||'',(0,f.isEmpty)(t.getCustomParameters())||(o.customParameters=JSON.stringify(t.getCustomParameters()));for(const[e,t]of Object.entries(s||{}))o[e]=t}if(t instanceof Yt){const e=t.getScopes().filter(e=>''!==e);e.length>0&&(o.scopes=e.join(','))}e.tenantId&&(o.tid=e.tenantId);const a=o;for(const e of Object.keys(a))void 0===a[e]&&delete a[e];const c=await e._getAppCheckToken(),u=c?`#${gs}=${encodeURIComponent(c)}`:'';return`${_s(e)}?${(0,f.querystring)(a).slice(1)}${u}`}function _s({config:e}){return e.emulator?z(e,ms):`https://${e.authDomain}/${fs}`}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const ys='webStorageSupport';const vs=class{constructor(){this.eventManagers={},this.iframes={},this.originValidationPromises={},this._redirectPersistence=kr,this._completeRedirectFn=Wi,this._overrideRedirectResult=Di}async _openPopup(e,t,n,r){F(this.eventManagers[e._key()]?.manager,'_initialize() not called before _openPopup()');return hs(e,await Is(e,t,n,V(),r),Cr())}async _openRedirect(e,t,n,r){await this._originValidation(e);return Mr(await Is(e,t,n,V(),r)),new Promise(()=>{})}_initialize(e){const t=e._key();if(this.eventManagers[t]){const{manager:e,promise:n}=this.eventManagers[t];return e?Promise.resolve(e):(F(n,'If manager is not set, promise should be'),n)}const n=this.initAndGetManager(e);return this.eventManagers[t]={promise:n},n.catch(()=>{delete this.eventManagers[t]}),n}async initAndGetManager(e){const t=await us(e),n=new Gi(e);return t.register('authEvent',t=>{U(t?.authEvent,e,"invalid-auth-event");return{status:n.onEvent(t.authEvent)?"ACK":"ERROR"}},gapi.iframes.CROSS_ORIGIN_IFRAMES_FILTER),this.eventManagers[e._key()]={manager:n},this.iframes[e._key()]=t,n}_isIframeWebStorageSupported(e,t){this.iframes[e._key()].send(ys,{type:ys},n=>{const r=n?.[0]?.[ys];void 0!==r&&t(!!r),R(e,"internal-error")},gapi.iframes.CROSS_ORIGIN_IFRAMES_FILTER)}_originValidation(e){const t=e._key();return this.originValidationPromises[t]||(this.originValidationPromises[t]=Qi(e)),this.originValidationPromises[t]}get _shouldInitProactively(){return $e()||Fe()||ze()}};class Ts{constructor(e){this.factorId=e}_process(e,t,n){switch(t.type){case"enroll":return this._finalizeEnroll(e,t.credential,n);case"signin":return this._finalizeSignIn(e,t.credential);default:return j('unexpected MultiFactorSessionType')}}}class Es extends Ts{constructor(e){super("phone"),this.credential=e}static _fromCredential(e){return new Es(e)}_finalizeEnroll(e,t,n){return mr(e,{idToken:t,displayName:n,phoneVerificationInfo:this.credential._makeVerificationRequest()})}_finalizeSignIn(e,t){return Xr(e,{mfaPendingCredential:t,phoneVerificationInfo:this.credential._makeVerificationRequest()})}}class ws{constructor(){}static assertion(e){return Es._fromCredential(e)}}ws.FACTOR_ID='phone';class bs{static assertionForEnrollment(e,t){return Ps._fromSecret(e,t)}static assertionForSignIn(e,t){return Ps._fromEnrollmentId(e,t)}static async generateSecret(e){const t=e;U(void 0!==t.user?.auth,"internal-error");const n=await(r=t.user.auth,i={idToken:t.credential,totpEnrollmentInfo:{}},Y(r,"POST","/v2/accounts/mfaEnrollment:start",J(r,i)));var r,i;return As._fromStartTotpMfaEnrollmentResponse(n,t.user.auth)}}bs.FACTOR_ID="totp";class Ps extends Ts{constructor(e,t,n){super("totp"),this.otp=e,this.enrollmentId=t,this.secret=n}static _fromSecret(e,t){return new Ps(t,void 0,e)}static _fromEnrollmentId(e,t){return new Ps(t,e)}async _finalizeEnroll(e,t,n){return U(void 0!==this.secret,e,"argument-error"),gr(e,{idToken:t,displayName:n,totpVerificationInfo:this.secret._makeTotpVerificationInfo(this.otp)})}async _finalizeSignIn(e,t){U(void 0!==this.enrollmentId&&void 0!==this.otp,e,"argument-error");const n={verificationCode:this.otp};return Qr(e,{mfaPendingCredential:t,mfaEnrollmentId:this.enrollmentId,totpVerificationInfo:n})}}class As{constructor(e,t,n,r,i,s,o){this.sessionInfo=s,this.auth=o,this.secretKey=e,this.hashingAlgorithm=t,this.codeLength=n,this.codeIntervalSeconds=r,this.enrollmentCompletionDeadline=i}static _fromStartTotpMfaEnrollmentResponse(e,t){return new As(e.totpSessionInfo.sharedSecretKey,e.totpSessionInfo.hashingAlgorithm,e.totpSessionInfo.verificationCodeLength,e.totpSessionInfo.periodSec,new Date(e.totpSessionInfo.finalizeEnrollmentTime).toUTCString(),e.totpSessionInfo.sessionInfo,t)}_makeTotpVerificationInfo(e){return{sessionInfo:this.sessionInfo,verificationCode:e}}generateQrCodeUrl(e,t){let n=!1;return(Ss(e)||Ss(t))&&(n=!0),n&&(Ss(e)&&(e=this.auth.currentUser?.email||'unknownuser'),Ss(t)&&(t=this.auth.name)),`otpauth://totp/${t}:${e}?secret=${this.secretKey}&issuer=${t}&algorithm=${this.hashingAlgorithm}&digits=${this.codeLength}`}}function Ss(e){return void 0===e||0===e?.length}var Os="@firebase/auth",ks="1.12.1";
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
class Rs{constructor(e){this.auth=e,this.internalListeners=new Map}getUid(){return this.assertAuthConfigured(),this.auth.currentUser?.uid||null}async getToken(e){if(this.assertAuthConfigured(),await this.auth._initializationPromise,!this.auth.currentUser)return null;return{accessToken:await this.auth.currentUser.getIdToken(e)}}addAuthTokenListener(e){if(this.assertAuthConfigured(),this.internalListeners.has(e))return;const t=this.auth.onIdTokenChanged(t=>{e(t?.stsTokenManager.accessToken||null)});this.internalListeners.set(e,t),this.updateProactiveRefresh()}removeAuthTokenListener(e){this.assertAuthConfigured();const t=this.internalListeners.get(e);t&&(this.internalListeners.delete(e),t(),this.updateProactiveRefresh())}assertAuthConfigured(){U(this.auth._initializationPromise,"dependent-sdk-initialized-before-auth")}updateProactiveRefresh(){this.internalListeners.size>0?this.auth._startProactiveRefresh():this.auth._stopProactiveRefresh()}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function Ns(e){switch(e){case"Node":return'node';case"ReactNative":return'rn';case"Worker":return'webworker';case"Cordova":return'cordova';case"WebExtension":return'web-extension';default:return}}
/**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
const Cs=(0,f.getExperimentalSetting)('authIdTokenMaxAge')||300;let Ds=null;const Ls=e=>async t=>{const n=t&&await t.getIdTokenResult(),r=n&&((new Date).getTime()-Date.parse(n.issuedAtTime))/1e3;if(r&&r>Cs)return;const i=n?.token;Ds!==i&&(Ds=i,await fetch(e,{method:i?'POST':'DELETE',headers:i?{Authorization:`Bearer ${i}`}:{}}))};function Ms(e=(0,p.getApp)()){const t=(0,p._getProvider)(e,'auth');if(t.isInitialized())return t.getImmediate();const n=mt(e,{popupRedirectResolver:vs,persistence:[Jr,wr,kr]}),r=(0,f.getExperimentalSetting)('authTokenSyncURL');if(r&&'boolean'==typeof isSecureContext&&isSecureContext){const e=new URL(r,location.origin);if(location.origin===e.origin){const t=Ls(e.toString());ir(n,t,()=>t(n.currentUser)),rr(n,e=>t(e))}}const i=(0,f.getDefaultEmulatorHost)('auth');return i&&It(n,`http://${i}`),n}var Us,js;Us={loadJS:e=>new Promise((t,n)=>{const r=document.createElement('script');r.setAttribute('src',e),r.onload=t,r.onerror=e=>{const t=N("internal-error");t.customData=e,n(t)},r.type='text/javascript',r.charset='UTF-8',(document.getElementsByTagName('head')?.[0]??document).appendChild(r)}),gapiScript:'https://apis.google.com/js/api.js',recaptchaV2Script:'https://www.google.com/recaptcha/api.js',recaptchaEnterpriseScript:'https://www.google.com/recaptcha/enterprise.js?render='},tt=Us,js="Browser",(0,p._registerComponent)(new g.Component("auth",(e,{options:t})=>{const n=e.getProvider('app').getImmediate(),r=e.getProvider('heartbeat'),i=e.getProvider('app-check-internal'),{apiKey:s,authDomain:o}=n.options;U(s&&!s.includes(':'),"invalid-api-key",{appName:n.name});const a={apiKey:s,authDomain:o,clientPlatform:js,apiHost:"identitytoolkit.googleapis.com",tokenApiHost:"securetoken.googleapis.com",apiScheme:"https",sdkClientVersion:Be(js)},c=new Qe(n,r,i,a);return gt(c,t),c},"PUBLIC").setInstantiationMode("EXPLICIT").setInstanceCreatedCallback((e,t,n)=>{e.getProvider("auth-internal").initialize()})),(0,p._registerComponent)(new g.Component("auth-internal",e=>(e=>new Rs(e))(Ze(e.getProvider("auth").getImmediate())),"PRIVATE").setInstantiationMode("EXPLICIT")),(0,p.registerVersion)(Os,ks,Ns(js)),(0,p.registerVersion)(Os,ks,'esm2020')},1377,[22,1368,1370,1372,1369]);