/*
 *
 * A simple stateless and opinionated api for CouchApps
 *
 * This api will only work with the specific rewrites.json
 * It does not require any setup, and will work no matter if you serve the app
 * from a couchdb vhost, or from the design doc rewriter. It doesn't care what
 * your database is named either, or if it's proxied behind a path.
 *
 * Depends on JSON and Promise
 *
 * The api is a singleton object named $Couch
 *
 * For older browsers polyfills might be needed.
 *
 */

(function() {
    'use strict';

    if (self.$Couch) {
        return
    }
    self.$Couch = {};

    var ERRORS = {
        'abort': new TypeError('Network request aborted'),
        'failed': new TypeError('Network request failed')
    }

    function getxhr() {
        if (self.XMLHttpRequest) {         // all normal browsers
            return new XMLHttpRequest();
        } else if (self.ActiveXObject) { // old IE
            try {
                return new ActiveXObject('Msxml2.XMLHTTP');
            }
            catch (e) {
                try {     // even older IE
                    return new ActiveXObject('Microsoft.XMLHTTP');
                }
                catch (e) {}
            }
        }
    }

    function URL(parts, params) {
       var qs = params ? '?' + encodeQueryString(params) : '';
       return parts.join('/') + qs;
    }

    function encodeQueryString(params) {
       var ret = [];
       for (var key in params)
          ret.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
       return ret.join('&');
    }
    function extend(obj, props) {
        for(var prop in props) {
            if(props.hasOwnProperty(prop)) {
                obj[prop] = props[prop];
            }
        }
    }

    function responseURL(xhr) {
        if ('responseURL' in xhr) {
          return xhr.responseURL
        }
        // Avoid security warnings on getResponseHeader when not allowed by CORS
        if (/^X-Request-URL:/m.test(xhr.getAllResponseHeaders())) {
          return xhr.getResponseHeader('X-Request-URL')
        }
        return null;
    }

    function fetchJSON(url, options) {
       return new Promise(function(resolve, reject) {
          var xhr = getxhr();

          xhr.onload = function() {
             var status = (xhr.status === 1223) ? 204 : xhr.status;
             if (status < 100 || status > 599) {
                reject(ERRORS.failed);
                return;
             }
             var response = {};
             response.ok = (xhr.status >= 200 && xhr.status < 300) || xhr.status == 304;
             response.status = xhr.status;
             response.statusText = xhr.statusText;
             response.url = responseURL(xhr);
             response.data = 'response' in xhr ? xhr.response : JSON.parse(xhr.responseText);
             resolve(response);
          }

          xhr.onerror = function() {
             reject(ERRORS.failed)
          }

          xhr.onabort = function() {
          }

          if (typeof options === 'undefined') {
              options = {}
          }
          xhr.open(options.method || 'get', url, true);

          xhr.setRequestHeader('Accept', 'application/json');
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.responseType = 'json';
          // xhr.withCredentials = true // see about CORS support

          var body = typeof options.body === 'undefined' ? null : JSON.stringify(options.body);
          xhr.send(body);

          if (options.canceller && options.canceller.then) {
             options.canceller.then(function (data) { xhr.abort(); reject(data); })
          }
       })
    }

    self.$Couch.get = function (id) {
        var url = URL(['api', id]);
        return fetchJSON(url).then(function(resp) {
           if (resp.ok) {
               return resp.data;
           }
           throw new TypeError(resp.statusText);
        })
    }

    self.$Couch.delete = function (id, rev) {
        var url = URL(['api', id], {rev:rev});
        return fetchJSON(url, { method: 'delete' } ).then(function(resp) {
           if (resp.ok) {
               return resp.data;
           }
           throw new TypeError(resp.statusText);
        })
    }

    self.$Couch.create = function (id, doc) {
        // if doc is undefined, id is actually the doc.
        // but since we don't have an id, POST to the database
        // otherwise it's a PUT to the ./api/<id>
        var url, method;
        if (doc === undefined) {
            doc = id;
            url = 'api/';
            method = 'post';
        } else {
            url = URL(['api', id]);
            method = 'put';
        }
        return fetchJSON(url, {method: method, body: doc}).then(function(resp) {
            if (resp.ok) {
                var cloned_doc = JSON.parse(JSON.stringify(doc));
                cloned_doc['_id'] = resp.data.id;
                cloned_doc['_rev'] = resp.data.rev;
                return cloned_doc;
            }
            throw new TypeError(resp.statusText);
        })
    }

    self.$Couch.update = function (doc) {
        var url = URL(['api', doc._id], {rev:doc._rev});
        return fetchJSON(url, {method: 'put', body: doc}).then(function(resp) {
            if (resp.ok) {
                var cloned_doc = JSON.parse(JSON.stringify(doc));
                cloned_doc['_id'] = resp.data.id;
                cloned_doc['_rev'] = resp.data.rev;
                return cloned_doc;
            }
            throw new TypeError(resp.statusText);
        })
    }

    self.$Couch.view = function (id, query_args) {
        var query = {
           update_seq: true,
           reduce: false
        }
        extend(query, query_args);

        // stringify if needed
        function assure_string(obj, attr) {
            if (obj && obj[attr] && typeof obj[attr] !== "string")
                obj[attr] = JSON.stringify(obj[attr]);
        }
        assure_string(query, "key");
        assure_string(query, "startkey");
        assure_string(query, "endkey");

        var url = URL(['ddoc', '_view', id], query);
        return fetchJSON(url).then(function(resp) {
           if (resp.ok) {
              return resp.data;
           }
           throw new TypeError(resp.statusText);
        })
    }

    /*
     * it'll stay subscribed to the _changes feed forever, and reconnect
     * on errors (using an exponentional backoff). also a watchdog is started
     * that will make sure the TCP/IP connection didn't get stuck.
     */
    function tryEventSource(url, params, em) {
        params.feed = 'eventsource';
        var fullurl = URL(url, params);
        var source = new self.EventSource(fullurl);
        var do_fallback = true;

        em.stopped.then(function () { source.close() });

        source.addEventListener('error', function(err) {
            if (source.readyState == self.EventSource.CLOSED &&
                           err.type == 'error' && err.eventPhase == 2) {
               if (do_fallback) {
                  // EventSource not supported on the backend, run the longpolled fallback
                  console.log('EventSource not supported on the backend? runing longpoll');
                  longPollFallback(url, params, em);
               }
            } else if (source.readyState == self.EventSource.CLOSED) {
               em.error(err);
            }
        }, false);

        source.addEventListener('message', function(ev) {
            var row = JSON.parse(ev.data);
            em.notify([row]);
        }, false);
    }

    function longPollFallback (url, params, em) {
       params.feed = 'longpoll';
       const TIMEOUT_SENTINEL = {};
       const RESEND_TIMEOUT = 3 * 60 * 1000;

       function _loop (last_seq) {
          var timeout = new Promise(function(resolve, reject) {
              self.setTimeout(function () { resolve(TIMEOUT_SENTINEL) }, RESEND_TIMEOUT)
          })
          var stopit = Promise.race([em.stopped, timeout]);
          params.since = last_seq;
          var fullurl = URL(url, params);
          fetchJSON(fullurl, {canceller: stopit})
            .then(function(resp) {
              var rows = resp.data.results;
              em.notify(rows);
              _loop(resp.data.last_seq);
            })
            .catch(function(err) {
               if (err === TIMEOUT_SENTINEL) {
                  _loop(last_seq);
               } else {
                  em.error(err);
               }
            })
       }
       _loop(params.since); // start it the first time
    }

    function fakeEventEmitter () {
        var callbacks = {changes:[], error:[]};
        this.on = function (topic, fn) {
            if (topic in callbacks)
                callbacks[topic].push(fn);
        }
        this.notify = function (rows) {
            callbacks['changes'].forEach( function(fn) { fn(rows) });
        }
        this.error = function (err) {
            callbacks['error'].forEach( function(fn) { fn(err) });
        }

        var this_ = this;
        this.stopped = new Promise(function(resolve, reject) {
           this_.stop = resolve;
        })
    }

    const HEARTBEAT = 20 * 1000;
    self.$Couch.changes = function (last_seq, query_args) {
        var params = {since: last_seq, heartbeat: HEARTBEAT}
        extend(params, query_args);

        var url = ['api', '_changes'];
        var em = new fakeEventEmitter();

        if(!!self.EventSource) {
            tryEventSource(url, params, em);
        } else {
            longPollFallback(url, params, em);
        }
        return em;
    }

    self.$Couch.init = function (auto_guesstimate_redirect) {
        return fetchJSON('api').then(function (resp) {
            if (!auto_guesstimate_redirect) {
                return resp;
            }
            if (resp.status == 404) {
                return fetchJSON('_rewrite/api');
            }
        }).then(function (resp) {
            if (auto_guesstimate_redirect && resp.status == 200) {
                self.location.replace('_rewrite/')
            } else {
                return resp;
            }
        })
    }

})();

/*
Copyright (C) 2015 by Damjan Georgievski <gdamjan@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
