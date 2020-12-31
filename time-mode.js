'use strict';
/*
*    *    *    *    *    * 
┬    ┬    ┬    ┬    ┬    ┬
│    │    │    │    │    │
│    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
│    │    │    │    └───── month (1 - 12)
│    │    │    └────────── day of month (1 - 31)
│    │    └─────────────── hour (0 - 23)
│    └──────────────────── minute (0 - 59)
└───────────────────────── second (0 - 59, OPTIONAL)
*/

const schedule = require('node-schedule');
const fs = require('fs');
const cron_parser = require('cron-parser');
const parser = require('cron-parser');
const log = console.log;

const rekuapi = require('./rekuapi');

class Error {
    constructor(message, code = 500, args = {}) {
        this.message = message;
        this.code = code;
        this.args = args;
    }
}

class CronIterator
{
    constructor() {
        this._timer = null;
        this._prev_time = new Date();
    }

    next() {
        let ctx = this.ctx;
        if (ctx.length == 0) {
            throw new Error("nothing scheduled");
        }
        let idx = 0;
        let res = ctx[0];
        for (let i = 0; i < ctx.length; ++i) {
            let item = ctx[i];
            if (item.toDate() < res.toDate()) {
                idx = i;
                res = item;
            }
        }

        this.when = res.toDate();
        this.idx = idx;
        ctx[idx] = this.intervals[idx].next();
    }

    _schedule_time() {
        let now = new Date();
        if (now < this._prev_time) {
            throw Error(500, "system time changed");            
        }
        this._prev_time = now;
        let rv = this.when - (new Date());
        return rv;
    }

    _follow(cb) {
        let t = this._schedule_time();
        log("waiting: ", t)
        if (t < 0) t = 0;
        if (t > 100000) t = 100000;
        this._timer = setTimeout(() => {
            this._exec(cb);
        }, t);
    }

    _exec(cb) {
        let t = this._schedule_time();
        let follow = () => {
            this._follow(cb);
        }
        if (t <= 0) {
            let idx = this.idx;
            let when = this.when;
            this.next();
            cb(idx, when, this.when - (new Date()), follow);
        } else {
            follow();
        }
    }

    is_running() {
        if (this._timer) return true;
        return false;
    }

    run(cb) {
        if (this.idx == -1) this.next();

        while (this._schedule_time() < 0) {
            let follow = () => {};
            let idx = this.idx;
            let when = this.when;
            this.next();
            if (this._schedule_time() >= 0) {
                follow = () => {
                    this._follow(cb);
                }
            }
            cb(idx, when, this.when - (new Date()), follow);
        }
    }

    reset(intervals) {
        if (this._timer != null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        this.intervals = intervals;
        this.ctx = [];
        this.idx = -1;
        for (let i = 0; i < intervals.length; ++i) {
            this.ctx.push(intervals[i].next());                          
        }
    }
}

class RecuContext {
    constructor(config) {
        this.old_power = -1;
        this.power = 0;
        this.config = config;
        this.dry = true;
        this.ACTION = {
            setPower: (args) => {
                this.power = args[0];
            }
        }
    }

    apply() {
        this.dry = false;
        console.log("apply");
        if (this.old_power != this.power) {
            console.log("updating power: " + this.old_power + " to: " +
                this.power);
        }
    }

    exec_default_actions(action) {
        if (this.dry) {
            return;
        }
        if (action === '$logstat') {
            log("logstat...");
            return true;
        }

        return false;
    }

    exec_action(action) {
        if (this.exec_default_actions(action)) {
            return;
        }

        let aconfig = this.config['actions'];
        let a = aconfig[action];

        if (!a) {
            return;
        }
        let proc = a['proc'];
        let args = a['args'];
        this.ACTION[proc](args);
    }
}

function serve() {
    let config_file_name = 'reku-timer.cron';
    let ci = new CronIterator();
    let mtime = null;
    let exiting = false;
    let running = false;


    function run_scheduler(config) {
        let ra = new RecuContext(config);
        let exprs = [];
        let options = {
            currentDate: new Date((new Date()) - (1000 * 60 * 60 * 24 * 7)),
            iterator: false
        };

        config.cron.forEach(rec => {
            exprs.push(cron_parser.parseExpression(rec.time, options));
        })

        ci.reset(exprs);
        ci.run((idx, when, nextt, follow) => {
            let now = new Date();
            let action = config.cron[idx].action;

            ra.exec_action(action);

            if (nextt > 0) {
                ra.apply();                
            }

        //    log("executing:", idx, when.toString(), action,
        //        "precision:", now - when);
 
            follow();
        });
    }

    function parse(content) {
        return JSON.parse(content);
    }

    function handle_config_change() {
        log("update settings...");
        fs.readFile(config_file_name, 'utf8', (err, data) => {
            try {
                let config = parse(data);
                run_scheduler(config);    
            } catch(err) {
                mtime = null;
                log(err);
            }
        })
    }

    function check_config_file_changed() {
        fs.stat(config_file_name, (err, stats) => {
            if (err) {
                console.log(err);
                setTimeout(check_config_file_changed, 5000);
                return;
            }

            if (mtime == null || mtime.getTime() !== stats.mtime.getTime()) {
                mtime = stats.mtime;
                handle_config_change();
            } else {
                log("config unchanged; running = " + ci.is_running());
            }
            if (!exiting) {
                setTimeout(check_config_file_changed, 5000);
            }
        });
    }

    check_config_file_changed();
}

serve();
