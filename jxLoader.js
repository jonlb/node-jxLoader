/**
 * The jxLoader main class which does all of the work of ordering files from various
 * repositories according to their dependencies.
 */

//requires
var yaml = require('yaml'),
    sys = require('sys'),
    fs = require('fs-promise'),
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

    config: {},
    repos: {},
    queue: [],
    flat: {},

    initialize: function (options) {
        this.setOptions(options);
    },

    /**
     * Add a repository to the loader
     * 
     * Paramaters:
     * config - The config should be an object that lists the appropriate keys for
     *      the listed repository.
     * domain - the domain to associate this repo with. optional. If excluded then this repository
     *          will be available to all domains and subdomains.
     */
    addRepository: function (config, domain) {


        Object.each(config, function(conf, key){
            if (!nil(this.config[domain]) && typeOf(this.config[domain]) == 'object') {

                    if (this.config[domain][key]){
                        this.config[domain][key] = Object.merge(this.config[domain][key], conf);
                    } else {
                        this.config[domain][key] = conf;
                    }

            } else {
                this.config[domain] = config;
            }

            if (nil(this.repos[key])) {
                this.loadRepository(key, conf);
            }

        }, this);


    },

    loadRepository: function (key, config) {
        var path = config.paths.js;

        //walk the path and process all files we find...
        Walker(path).filterDir(function(dir){
            core.debug('walking dir',dir);
            return !(dir.test('^\.[\S\s]*$','i'));
        }).on('file', function(file){
            core.debug('processing file',file);
            fs.readFile(file, 'utf-8').then(function(data){
                //process the file
                var descriptor = {},
                    regexp = /-{3}\s*\n*([\S\s]*)\n*\.{3}/,  //regexp to get yaml contents
                    matches = regexp.exec(data);

                if (!nil(matches)) {
                    descriptor = yaml.eval(matches[1]);

                    var requires = Array.from(!nil(descriptor.requires) ? descriptor.requires : []);
                    var provides = Array.from(!nil(descriptor.provides) ? descriptor.provides : []);
                    var optional = Array.from(!nil(descriptor.optional) ? descriptor.optional : []);
                    var filename = path.basename(file);

                    //normalize requires and optional. Fills up the default package name
                    //if one is not present and strips version info
                    requires.each(function(r, i){
                        requires[i] = this.parse_name(key, r).join('/');
                    },this);

                    optional.each(function(r, i){
                        optional[i] = this.parse_name(key, r).join('/');
                    },this);

                    this.repos[key][filename] = Object.merge(descriptor,{
                        repo: key,
                        requires: requires,
                        provides: provides,
                        optional: optional,
                        path: file
                    });

                } else {
                    //there is no yaml header... drop this file
                    return;
                }

            }.bind(this), function(err){
                //do nothing, just finish up
                core.debug('no file',file);
                return;
            }.bind(this));
        });
    },

    parse_name: function (def, name){
        var exploded = name.split('/');
        if (exploded.length == 1) {
            return [def, exploded[0]];
        }
        if (nil(exploded[0])) {
            return [def, exploded[1]];
        }
        var exploded2 = exploded.split(':');
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

        if (!nil(repos)) {
            Array.from(repos).each(function(val){
                var o = {};
                o[val] = this.repos[val];
                var flat = this.flatten(o);
                flat.each(function(obj, key){
                    list = this.includeDependencies(val, key, opts, exclude, list, type, [key]);
                },this);
            },this);
        }

        if (!nil(classes)) {
            classes.each(function(val){
                var r = this.findRepo(val);
                //clear visited reference
                this.flat.each(function(obj, key){
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

        var deps;
        if (includeDeps) {
            deps = this.compileDeps(classes, repos, type, opts, exclude);
        } else {
            deps = this.convertClassesToDeps(classes, type, exclude);
        }

        if (deps.length > 0) {
            var included = [],
                sources = [],
                ret;

            if (type == 'js') {
                ret = this.getJsFiles(sources, included, deps);
            } else {
                ret = this.getCssFiles(sources, included, theme, deps);
            }

            return {
                included: ret.included,
                source: ret.source.join('\n\n')
            }
        } else {
            return false;
        }
    },

    includeDependencies: function (repo, klass, opts, exclude, flat, list, type, ml) {
        klass = klass.contains('/') ? klass : repo.toLowerCase() + '/' + klass.toLowerCase();

        if (Object.keys(flat).contains(klass)) {
            return list;
        }

        var inf = flat[klass];

        if ((inf.visited && ml.contains(klass))
            || (type=='js' && (exclude.contains(inf.path) || list.contains(inf.path)))
            || (type=='css' && (exclude.contains(klass) || list.contains(klass)))
            || (type=='jsdeps' && (exclude.contains(inf.path) || list.contains(klass)))) {
            return list;
        }

        var requires = Array.from(inf.requires);
        flat[klass]['visited'] = true;
        if (opts && Object.keys(inf).contains(optional) && inf.optional.length > 0) {
            requires = Array.merge(requires, inf.optional);  //check if Array.merge is correct
        }
        if (requires.length > 0) {
            requires.each(function(req){
                var parts = req.split('/');
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

    },

    findRepo: function(klass) {

    },

    getJsFiles: function (sources, included, deps) {

    },

    getCssFiles: function (sources, included, theme, deps) {

    }


});

//core.debug('jxLoader object',jxLoader);
exports.jxLoader = jxLoader;