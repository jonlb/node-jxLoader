/**
 * The jxLoader main class which does all of the work of ordering files from various
 * repositories according to their dependencies.
 */

//requires
var yaml = require('js-yaml').YAML,
    sys = require('sys'),
    fsp = require('fs-promise'),
    fs = require('fs'),
    path = require('path'),
    Walker = require('walker');

//check to see if mootools is already in the environment
if (typeof MooTools == 'undefined') {
    require('mootools').apply(GLOBAL);
    sys.puts('loaded mootools');
} else {
    sys.puts('mootools already loaded');
}

var jxLoader = new Class({

    Implements: [Events, Options],

    options: {},

    config: null,
    repos: null,
    flat: null,
    numRepos: 0,
    loadedRepos: 0,

    initialize: function (options) {
        this.setOptions(options);
        this.config = {};
        this.repos = {};
    },

    /**
     * Add a repository to the loader
     * 
     * Paramaters:
     * config - The config should be an object that lists the appropriate keys for
     *      the listed repository
     */
    addRepository: function (config) {


        this.config = Object.merge(this.config, {repos: config});
        
        this.numRepos = Object.getLength(this.config.repos);
        
        Object.each(this.config.repos, function(conf, key){
            if (nil(this.repos[key])) {
                this.loadRepository(key, conf);
            }
        },this);




    },

    loadRepository: function (key, config) {
        var p = config.paths.js,
            me = this;

        //walk the path and process all files we find...
        Walker(p).filterDir(function(dir){
            return !(dir.test('^\.[\S\s]*$','i'));
        }).on('file', function(file){
            var debug = (file == '');
            try {
                var data = fs.readFileSync(file, 'utf-8');
                
               if (debug) sys.puts('File contents: ' + sys.inspect(data));
                //process the file
                var descriptor = {},
                    regexp = /^-{3}\s*\n*([\S\s]*)\n+\.{3}/m,  //regexp to get yaml contents
                    matches = data.match(regexp);

                if (debug) sys.puts('All matches from getting yaml headers: ' + sys.inspect(matches));

                if (!nil(matches)) {
                    matches.shift();
                    delete matches.index;
                    delete matches.input;
                    if (debug) sys.puts('matches is a ' + typeOf(matches));
                    if (debug) sys.puts('Matches from getting yaml headers: ' + matches[0]);
                    //remove \n from the string
                    var str = matches[0].replace(new RegExp('\r','g'),'');
                    if (debug) sys.puts('Matches from getting yaml headers after replacement: ' + str);
                    try {
                        descriptor = yaml.evaluate(str, debug);
                    } catch (err) {
                        sys.puts('!!! error converting yaml');
                        sys.puts('YAML object: ' + sys.inspect(yaml));
                        sys.puts('error: ' + sys.inspect(err));
                        throw err;
                    }

                    if (debug) sys.puts('object returned from yaml eval = ' + sys.inspect(descriptor));

                    var requires = Array.from(!nil(descriptor.requires) ? descriptor.requires : []);
                    var provides = Array.from(!nil(descriptor.provides) ? descriptor.provides : []);
                    var optional = Array.from(!nil(descriptor.optional) ? descriptor.optional : []);
                    var filename = path.basename(file);

                    //normalize requires and optional. Fills up the default package name
                    //if one is not present and strips version info
                    requires.each(function(r, i){
                        requires[i] = me.parse_name(key, r).join('/').replace(' ','');
                    },this);

                    optional.each(function(r, i){
                        optional[i] = me.parse_name(key, r).join('/').replace(' ','');
                    },this);

                    if (nil(me.repos[key])) {
                        me.repos[key] = {};
                    }
                    me.repos[key][filename] = Object.merge(descriptor,{
                        repo: key,
                        requires: requires,
                        provides: provides,
                        optional: optional,
                        path: file
                    });

                    if (debug) sys.puts('Done processing ' + filename);
                } else {
                    //there is no yaml header... drop this file
                    sys.puts('no header for ' + file);
                    if (debug) throw new Error();
                }



            } catch (err) {
                sys.puts('!!!err : ' + sys.inspect(err));
                //do nothing, just finish up
                //sys.puts('no file ' + file);
                throw err;
            }

            return;
        })
        .on('end',function(){
            this.loadedRepos++;
            if (this.loadedRepos == this.numRepos) {
                this.fireEvent('loadRepoDone', [key]);
            }
        }.bind(this));
    },

    parse_name: function (def, name){
       var exploded = name.split('/');
        //sys.puts('exploded = ' + sys.inspect(exploded));
        if (exploded.length == 1) {
            return [def, exploded[0]];
        }
        if (nil(exploded[0])) {
            return [def, exploded[1]];
        }
        var exploded2 = exploded[0].split(':');
        if (exploded2.length == 1) {
            return exploded;
        }
        return [exploded2[0],exploded[1]];
    },

    flatten: function (obj) {
        var flat = {};
        Object.each(obj, function(items, repo){
            Object.each(items, function(value, key){
                value.provides.each(function(val){
                    val = val.replace(' ','');
                    flat[repo.toLowerCase() + '/' + val.toLowerCase()] = value;
                },this);
            },this);
        },this);

        return flat;
    },

    getRepoArray: function () {
        return this.repo;
    },

    getFlatArray: function () {
        return this.flat;
    },

    compileDeps: function (classes, repos, type, opts, exclude) {
        opts = !nil(opts) ? opts : true;
        exclude = !nil(exclude) ? exclude : [];

        var list = [];
        
        if (nil(this.flat)) {
            this.flat = this.flatten(this.repos);
        }

        if (!nil(repos)) {
            Array.from(repos).each(function(val){
                var o = {};
                o[val] = this.repos[val];
                var flat = this.flatten(o);
                Object.each(flat, function(obj, key){
                    list = this.includeDependencies(val, key, opts, exclude, flat, list, type, [key]);
                },this);
            },this);
        }

        if (!nil(classes)) {
            classes.each(function(val){
                var r = this.findRepo(val);
                //clear visited reference
                Object.each(this.flat, function(obj, key){
                    obj.visited = false;
                },this);
                list = this.includeDependencies(r, val, opts, exclude, this.flat, list, type);
            },this);
        }
        sys.puts('list of dependencies: ' + sys.inspect(list));
        return list;
    },

    compile: function (classes, repos, type, includeDeps, theme, exclude, opts) {
        type = !nil(type) ? type : 'js';
        includeDeps = !nil(includeDeps) ? includeDeps : true;
        theme = !nil(theme) ? theme : '';
        exclude = !nil(exclude) ? exclude : [];
        opts = !nil(opts) ? opts : true;

        if (nil(this.flat)) {
            this.flat = this.flatten(this.repos);
        }
        
        var deps, 
            ret;
            
        
        if (includeDeps || !nil(repos)) {
            deps = this.compileDeps(classes, repos, type, opts, exclude);
        } else {
            deps = this.convertClassesToDeps(classes, type, exclude);
        }

        if (deps.length > 0) {
            var included = [],
                sources = [],
                ret2;

            if (type == 'js') {
               ret2 = this.getJsFiles(sources, included, deps);
            } else {
                ret2 = this.getCssFiles(sources, included, theme, deps);
            }

            ret = {
                included: ret2.includes,
                source: ret2.sources.join('\n\n')
            };
        } else {
            ret = false;
        }
        return ret;
    },

    includeDependencies: function (repo, klass, opts, exclude, flat, list, type, ml) {
        klass = klass.contains('/') ? klass : repo.toLowerCase() + '/' + klass.toLowerCase();

        if (!Object.keys(flat).contains(klass)) {
            return list;
        }

        var inf = flat[klass];

        if ((inf.visited && ml.contains(klass)) ||
            (type=='js' && (exclude.contains(inf.path) || list.contains(inf.path))) ||
            (type=='css' && (exclude.contains(klass) || list.contains(klass))) ||
            (type=='jsdeps' && (exclude.contains(inf.path) || list.contains(klass)))) {
            return list;
        }

        var requires = Array.from(inf.requires);
        flat[klass].visited = true;
        if (opts && Object.keys(inf).contains(optional) && inf.optional.length > 0) {
            requires = Array.merge(requires, inf.optional);  //check if Array.merge is correct
        }
        if (requires.length > 0) {
            requires.each(function(req){
                var parts = req.split('/');
                if (nil(ml)) {
                    ml = [];
                }
                ml.push(klass);
                list = this.includeDependencies(parts[0],parts[1],opts, exclude, flat, list, type, ml);
                ml.pop();
            },this);
        }

        if (type=='js') {
            list.push(inf.path);
        } else {
            list.push(klass);
        }

        return list;
    },

    convertClassesToDeps: function (classes, type, exclude) {
        var list;

        if (typeOf(classes) != 'array') {
            classes = Array.from(classes);
        }

        classes.each(function(klass){
            if (klass.contains('/')) {
                if (type=='js' && !exclude.contains(this.flat[klass.toLowerCase()].path)) {
                    list.push(this.flat[klass.toLowerCase()].path);
                } else if (type=='css' && !exclude.contains(klass)) {
                    list.push(klass);
                } else {
                    Object.each(this.flat, function(arr, key) {
                        var parts = key.split('/');
                        if (parts[0].toLowerCase() == klass.toLowerCase()) {
                            if (type=='js' && !exclude.contains(arr.path)) {
                                list.push(arr.path);
                            } else if (type=='css' && !exclude.contains(klass)) {
                                list.push(key);
                            }
                        }
                    },this);
                }
            }
        },this);

        return list;
    },

    findRepo: function(klass) {
        if (klass.contains('/')) {
            var parts = klass.split('/');
            return parts[0];
        } else {
            if (nil(this.flat)) {
                this.flat = this.flatten(this.repos);
            }
            var ret;
            Object.each(this.flat, function(arr, key){
                var parts = key.split('/');
                if (parts[1].toLowerCase() == klass.toLowerCase()) {
                    ret = parts[0];
                }
            },this);
            return ret;
        }
    },

    getJsFiles: function (sources, included, deps) {
        deps.each(function(filename){
            var s = fs.readFileSync(filename, 'utf-8');
            sources.push(s);
            included.push(filename);
        },this);
        return {
            includes: included,
            sources: sources
        };
    },

    getCssFiles: function (sources, included, theme, deps) {
        deps.each(function(dep){
            var parts = dep.split('/');
            included.push(dep);
            if (!nil(this.config.repos[parts[0]].paths.css)) {
                var csspath = this.config.repos[parts[0]].paths.css;
                csspath = csspath.replace('{theme}',theme);
                csspath = fs.realpathSync(csspath);
                var cssfiles = !nil(this.flat[dep].css) ? this.flat[dep].css : '';

                if (cssfiles.length > 0) {
                    cssfiles.each(function(css){
                        var fp = csspath + '/' + css + '.css';
                        if (path.existsSync(fp)) {
                            var s = fs.readFileSync(fp, 'utf-8');
                            if (this.options.rewriteImageUrl && !nil(this.config.repos[parts[0]].imageUrl)) {
                                s = s.replace(new RegExp(this.config.repos[parts[0]].imageUrl, 'g'),this.options.imagePath);
                            } else {
                                sys.puts('not updating urls in css file ' + css);
                            }
                            sources.push(s);
                        } else {
                            if (!nil(this.config.repos[parts[0]].paths.cssalt)) {
                                var csspathalt = this.config.repos[parts[0]].paths.cssalt;
                                csspathalt = csspathalt.replace('{theme}',theme);
                                csspathalt = fs.realpathSync(csspathalt);
                                fp = csspathalt + '/' + css + '.css';
                                if (path.existsSync(fp)) {
                                    var s = fs.readFileSync(fp, 'utf-8');
                                    if (this.options.rewriteImageUrl && !nil(this.config.repos[parts[0]].imageUrl)) {
                                        s = s.replace(new RegExp(this.config.repos[parts[0]].imageUrl, 'g'),this.options.imagePath);
                                    } else {
                                        sys.puts('not updating urls in css file ' + css);
                                    }
                                    sources.push(s);
                                }
                            }
                        }
                    },this);

                    if (this.options.moveImages && !nil(this.flat[dep].images)) {
                        var imageFiles = this.flat[dep].images;
                        if (imageFiles.length > 0) {
                            var ipath = this.config.repos[parts[0]].paths.images,
                                imageLocation = this.config.repos[parts[0]].imageLocation;

                            if (ipath.contains('{theme}')) {
                                ipath = ipath.replace('{theme}', theme);
                            }
                            ipath = fs.realpathSync(ipath);

                            //create destination if it's not already there
                            if (!path.existsSync(imageLocation)) {
                                fs.mkdirSync(imageLocation);
                            }

                            imageFiles.each(function(file){
                                if (!path.existsSync(imageLocation + '/' + file)) {
                                    var inStr = fs.createReadStream(ipath + '/' + file),
                                        outStr = fs.createWriteStream(imageLocation + '/' + file);

                                    inStr.pipe(outStr);
                                } else {
                                    sys.puts('\t\tFile already exists');
                                }
                            },this);
                        } else {
                            sys.puts('No image files to move');
                        }
                    } else {
                        sys.puts('Not moving image files');
                    }
                }
            }
        },this);
        
        return {
            includes: included,
            sources: sources
        };
    }


});

exports.jxLoader = jxLoader;