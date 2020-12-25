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
        this.timer = null;
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

    _exec(cb) {
        for (;;) {
            let t = this.when - (new Date());
            if (t > 0) return t;
            cb(this.idx, this.when);
            this.next();
        }
    }

    _run(cb) {
        let t = this._exec(cb);
        log("next task scheduled: ", this.idx, this.when.toString(),
            "delta=", t);
        if (t > 100000) t = 100000;
        this.timer = setTimeout(() => {
            this._run(cb);            
        }, t);
    }

    run(cb) {
        if (this.idx == -1) this.next();
        setImmediate(() => {
            this._run(cb);
        });
    }

    reset(intervals) {
        if (this.timer != null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.intervals = intervals;
        this.ctx = [];
        this.idx = -1;
        for (let i = 0; i < intervals.length; ++i) {
            this.ctx.push(intervals[i].next());                          
        }
    }
}

function serve() {
    let config_file_name = 'reku-timer.cron';
    let ci = new CronIterator();
    let mtime = null;

    function run_scheduler(config) {
        let exprs = [] 
        config.cron.forEach(rec => {
            exprs.push(cron_parser.parseExpression(rec.time));
        })

        ci.reset(exprs);
        ci.run((idx, when) => {
            let now = new Date();
            let action = config.cron[idx].action;
            log("executing:", idx, when.toString(), action,
                "precision:", now - when);
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
                log("config unchanged");
            }

            setTimeout(check_config_file_changed, 5000);
        });
    }

    check_config_file_changed();
}

serve();
