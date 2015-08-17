# CouchApp starter pack

This project mainly centers around my very opinionated couchdb library. A short list of features:

 * no configuration - it assumes the couchdb rewrites are set (as seen in `rewrites.json`) and
you're hitting the rewriter (which is set to app.html - don't open it directly)
 * supports EventSouce for the changes feed, falls back to long poll
 * uses promises, a polyfill would be needed for older browsers
 * uses JSON.parse and stringify, a polyfill would be needed for even older browsers
 * otherwise should work on all

Some examples:

### Document apis

```javascript
$Couch.create({a: 'a'})
  .then( (doc) => { console.log(doc); return doc })
  .then( (doc) => { doc.b = 'b'; return $Couch.update(doc) })
  .then( (doc) => { console.log(doc); return doc })
  .then( (doc) => { return $Couch.get(doc._id) })
  .then( (doc) => { console.log(doc); return doc })
```

### Views

```javascript
$Couch.view('v1')
  .then((result) => console.log(result))

$Couch.view('v1', {reduce:false})
  .then((result) => console.log(result))

$Couch.view('v1', {include_docs:true})
  .then((result) => result.rows.map((row)=> console.log(row.doc._rev)))
```

### Pagination (WIP)

```javascript
var pagenext;
$Couch.view('v1', {include_docs:true})
  .then((result) => { pagenext = result.paginate.next; return result})
  .then((result) => { result.rows.map( (row) => console.log(row.id) ) })
```

### Changes

```javascript
var em = $Couch.changes(0);
em.on('error', (err) => console.error(err) );
em.on('changes', (rows) => {
  rows.forEach( (elt) => {
    console.log('Document ' + elt.id + ' with ' + elt.changes.length + ' changes.')
  })
})
// and some time later
em.stop();
```

## Push to CouchDB

```bash
$ erica push dbname
==> Successfully pushed. You can browse it at: http://localhost:5984/dbname/_design/helloworld/_rewrite/
```
or
```bash
$ erica push https://user:pass@db.example.net/dbname
==> Successfully pushed. You can browse it at: https://user:pass@db.example.net/dbname/_design/helloworld/_rewrite/
```

## CouchDB Vhosts

See http://docs.couchdb.org/en/stable/config/http.html#config-vhosts

You'd map a name to the rewrite url, for ex:

```ini
[vhosts]
db.example.net = /dbname/_design/helloworld/_rewrite
```
