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
    static STAGE_STARTUP = 1;
    static STAGE_RUN = 2;
    static LOOKAHEAD_CNT = 11;

    constructor() {
        this._timer = null;
        this._prev_time = new Date();
        this._lookahead = []
        this._running_past = true;
    }

    lookahead() {
        let n = CronIterator.LOOKAHEAD_CNT;
        let ctx = this.ctx;
        while (this._lookahead.length < n) {
            let idx = 0;
            let res = ctx[0];
            for (let i = 0; i < ctx.length; ++i) {
                let item = ctx[i];
                if (item.toDate() < res.toDate()) {
                    idx = i;
                    res = item;
                }
            }

            this._lookahead.push({
                when: res.toDate(),
                idx: idx
            });
            ctx[idx] = this.intervals[idx].next();
        }
    }

    next() {
        this.lookahead();
        return this._lookahead.shift();
    }

    lookup_next() {
        this.lookahead();
        return this._lookahead[0];
    }

    _schedule_time() {
        this.lookahead();
        if (this._lookahead.length == 0) {
            throw Error(500, "nothing to schedule");
        }
        let now = new Date();
        if (now < this._prev_time) {
            throw Error(500, "system time changed");            
        }
        this._prev_time = now;
        let rv = this._lookahead[0].when - now;
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
        return true;
    }

    _exec(cb) {
        let t = this._schedule_time();
        let follow = () => {
            this._follow(cb);
        }
        if (t <= 0) {
            let now = new Date();
            let job = this.next();
            cb(job.idx, job.when, CronIterator.STAGE_RUN, follow);
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

        let cnt = 0;

        while (this._schedule_time() < 0) {
            let follow = () => { return false; };
            let now = new Date();
            let job = this.next();
            if (this._schedule_time() >= 0) {
                follow = () => {
                    this._follow(cb);
                }
            }
            cnt += 1
            cb(job.idx, job.when, CronIterator.STAGE_STARTUP, follow);
        }

        this._running_past = false;
        if (cnt == 0) {
            this._follow(cb);
        }
    }

    reset(intervals) {
        if (intervals.length == 0) {
            throw Error(500, "nothing to shchedule");
        }
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
        this.power = -1;
        this.config = config;
        this.dry = true;
        this.ACTION = {
            setPower: (args) => {
                this.power = args[0];
            }
        }
    }

    get_stat() {
        let rv = {
            power: this.power
        };
        return rv;
    }

    static check_stat(s) {
        if (s.power < 0 || s.power > 100) {
            throw Error(500, "invalid power value");
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
        ci.run((idx, when, stage, follow) => {
            let prev_stat = ra.get_stat(); 

            let action = config.cron[idx].action;
            ra.exec_action(action);

            if (stage == CronIterator.STAGE_RUN) {
                let next_stat = ra.get_stat();
                RecuContext.check_stat(next_stat);
                log(next_stat, action);
                log(ci._lookahead);
            }

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
