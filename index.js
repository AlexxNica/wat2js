#!/usr/bin/env node

process.title = 'wat2js'

var minimist = require('minimist')
var proc = require('child_process')
var os = require('os')
var path = require('path')
var fs = require('fs')

var argv = minimist(process.argv.slice(2), {
  alias: {output: 'o', watch: 'w'},
  boolean: ['w']
})

var inp = argv._[0]

if (!inp) {
  console.error(`
Usage: wat2js [input.wat file] [options...]
  --output, -o [output.js file]
  --watch,  -w [recompile on input.wat change]
  `.trim())
  process.exit(1)
}

if (argv.watch && !argv.output) {
  console.error('--watch requires --output')
  process.exit(2)
}

if (argv.watch) fs.watch(inp, compile)
compile()

function compile () {
  var tmp = path.join(os.tmpdir(), 'out.wasm.' + Date.now())

  proc.spawn('wat2wasm', [inp, '-o', tmp], {stdio: 'inherit'}).on('exit', function (code) {
    if (code) {
      if (argv.watch) return
      process.exit(1)
    }

    var wasm = fs.readFileSync(tmp, 'base64')
    fs.unlink(tmp, noop)

    var src = `
      module.exports = loadWebAssembly

      loadWebAssembly.supported = typeof WebAssembly !== 'undefined'

      function loadWebAssembly (opts) {
        if (!loadWebAssembly.supported) return null

        var imp = opts && opts.imports
        var wasm = toUint8Array('${wasm}')
        var ready = null

        var mod = {
          buffer: wasm,
          memory: null,
          exports: null,
          realloc: realloc,
          onload: onload
        }

        onload(function () {})

        return mod

        function realloc (size) {
          mod.exports.memory.grow(Math.ceil(Math.abs(size - mod.memory.length) / 65536))
          mod.memory = new Uint8Array(mod.exports.memory.buffer)
        }

        function onload (cb) {
          if (mod.exports) return cb()

          if (ready) {
            ready.then(cb.bind(null, null)).catch(cb)
            return
          }

          try {
            if (opts && opts.async) throw new Error('async')
            setup({instance: new WebAssembly.Instance(new WebAssembly.Module(wasm), imp)})
          } catch (err) {
            ready = WebAssembly.instantiate(wasm, imp).then(setup)
          }

          onload(cb)
        }

        function setup (w) {
          mod.exports = w.instance.exports
          mod.memory = mod.exports.memory && mod.exports.memory.buffer && new Uint8Array(mod.exports.memory.buffer)
        }
      }

      function toUint8Array (s) {
        if (typeof atob === 'function') return new Uint8Array(atob(s).split('').map(charCodeAt))
        return new (require('buf' + 'fer').Buffer)(s, 'base64')
      }

      function charCodeAt (c) {
        return c.charCodeAt(0)
      }
      `.replace(/^      /gm, '')

    if (argv.output) fs.writeFileSync(argv.output, src)
    else process.stdout.write(src)
  })
}

function noop () {}
