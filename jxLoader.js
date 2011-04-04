/**
 * The jxLoader main class which does all of the work of ordering files from various
 * repositories according to their dependencies.
 */

//requires
var yaml = require('yaml');

//check to see if mootools is already in the environment
if (typeof MooTools == 'undefined') {
    require('mootools').apply(GLOBAL);
};

exports = new Class({

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
        if (!nil(this.config[domain]) && typeOf(this.config[domain]) == 'object') {
            Object.each(config, function(conf, key){
                if (this.config[domain][key]){
                    this.config[domain][key] = Object.merge(this.config[domain][key], conf);
                } else {
                    this.config[domain][key] = conf;
                }
            }, this);
        } else {
            this.config[domain] = config;
        }

        Object.each(config, function(conf, key){
            if (nil(this.repos[key])) {
                this.loadRepository(key, conf);
            }

            //normalize paths
            if (!nil(conf.paths.css)) {
                conf.paths.css = this.normalizePath(conf.paths.css);
            }
            if (!nil(conf.paths.cssalt)) {
                conf.paths.cssalt = this.normalizePath(conf.paths.cssalt);
            }
            if (!nil(conf.paths.images)) {
                conf.paths.images = this.normalizePath(conf.paths.images);
            }
        }, this);

        


    },

    loadRepository: function (key, config) {

    },

    normalizePath: function (path) {

    }

});