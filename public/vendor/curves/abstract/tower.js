import { bitGet, bitLen, concatBytes, notImplemented } from '../utils.js';
import * as mod from './modular.js';
const _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _3n = BigInt(3);
function calcFrobeniusCoefficients(Fp, nonResidue, modulus, degree, num = 1, divisor) {
    const _divisor = BigInt(divisor === undefined ? degree : divisor);
    const towerModulus = modulus ** BigInt(degree);
    const res = [];
    for (let i = 0; i < num; i++) {
        const a = BigInt(i + 1);
        const powers = [];
        for (let j = 0, qPower = _1n; j < degree; j++) {
            const power = ((a * qPower - a) / _divisor) % towerModulus;
            powers.push(Fp.pow(nonResidue, power));
            qPower *= modulus;
        }
        res.push(powers);
    }
    return res;
}
export function psiFrobenius(Fp, Fp2, base) {
    const PSI_X = Fp2.pow(base, (Fp.ORDER - _1n) / _3n);
    const PSI_Y = Fp2.pow(base, (Fp.ORDER - _1n) / _2n);
    function psi(x, y) {
        const x2 = Fp2.mul(Fp2.frobeniusMap(x, 1), PSI_X);
        const y2 = Fp2.mul(Fp2.frobeniusMap(y, 1), PSI_Y);
        return [x2, y2];
    }
    const PSI2_X = Fp2.pow(base, (Fp.ORDER ** _2n - _1n) / _3n);
    const PSI2_Y = Fp2.pow(base, (Fp.ORDER ** _2n - _1n) / _2n);
    if (!Fp2.eql(PSI2_Y, Fp2.neg(Fp2.ONE)))
        throw new Error('psiFrobenius: PSI2_Y!==-1');
    function psi2(x, y) {
        return [Fp2.mul(x, PSI2_X), Fp2.neg(y)];
    }
    const mapAffine = (fn) => (c, P) => {
        const affine = P.toAffine();
        const p = fn(affine.x, affine.y);
        return c.fromAffine({ x: p[0], y: p[1] });
    };
    const G2psi = mapAffine(psi);
    const G2psi2 = mapAffine(psi2);
    return { psi, psi2, G2psi, G2psi2, PSI_X, PSI_Y, PSI2_X, PSI2_Y };
}
const Fp2fromBigTuple = (Fp, tuple) => {
    if (tuple.length !== 2)
        throw new Error('invalid tuple');
    const fps = tuple.map((n) => Fp.create(n));
    return { c0: fps[0], c1: fps[1] };
};
class _Field2 {
    ORDER;
    BITS;
    BYTES;
    isLE;
    MASK = _1n;
    ZERO;
    ONE;
    Fp;
    NONRESIDUE;
    mulByB;
    Fp_NONRESIDUE;
    Fp_div2;
    FROBENIUS_COEFFICIENTS;
    constructor(Fp, opts = {}) {
        const ORDER = Fp.ORDER;
        const FP2_ORDER = ORDER * ORDER;
        this.Fp = Fp;
        this.ORDER = FP2_ORDER;
        this.BITS = bitLen(FP2_ORDER);
        this.BYTES = Math.ceil(bitLen(FP2_ORDER) / 8);
        this.isLE = Fp.isLE;
        this.ZERO = { c0: Fp.ZERO, c1: Fp.ZERO };
        this.ONE = { c0: Fp.ONE, c1: Fp.ZERO };
        this.Fp_NONRESIDUE = Fp.create(opts.NONRESIDUE || BigInt(-1));
        this.Fp_div2 = Fp.div(Fp.ONE, _2n);
        this.NONRESIDUE = Fp2fromBigTuple(Fp, opts.FP2_NONRESIDUE);
        this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp, this.Fp_NONRESIDUE, Fp.ORDER, 2)[0];
        this.mulByB = opts.Fp2mulByB;
        Object.seal(this);
    }
    fromBigTuple(tuple) {
        return Fp2fromBigTuple(this.Fp, tuple);
    }
    create(num) {
        return num;
    }
    isValid({ c0, c1 }) {
        function isValidC(num, ORDER) {
            return typeof num === 'bigint' && _0n <= num && num < ORDER;
        }
        return isValidC(c0, this.ORDER) && isValidC(c1, this.ORDER);
    }
    is0({ c0, c1 }) {
        return this.Fp.is0(c0) && this.Fp.is0(c1);
    }
    isValidNot0(num) {
        return !this.is0(num) && this.isValid(num);
    }
    eql({ c0, c1 }, { c0: r0, c1: r1 }) {
        return this.Fp.eql(c0, r0) && this.Fp.eql(c1, r1);
    }
    neg({ c0, c1 }) {
        return { c0: this.Fp.neg(c0), c1: this.Fp.neg(c1) };
    }
    pow(num, power) {
        return mod.FpPow(this, num, power);
    }
    invertBatch(nums) {
        return mod.FpInvertBatch(this, nums);
    }
    add(f1, f2) {
        const { c0, c1 } = f1;
        const { c0: r0, c1: r1 } = f2;
        return {
            c0: this.Fp.add(c0, r0),
            c1: this.Fp.add(c1, r1),
        };
    }
    sub({ c0, c1 }, { c0: r0, c1: r1 }) {
        return {
            c0: this.Fp.sub(c0, r0),
            c1: this.Fp.sub(c1, r1),
        };
    }
    mul({ c0, c1 }, rhs) {
        const { Fp } = this;
        if (typeof rhs === 'bigint')
            return { c0: Fp.mul(c0, rhs), c1: Fp.mul(c1, rhs) };
        const { c0: r0, c1: r1 } = rhs;
        let t1 = Fp.mul(c0, r0);
        let t2 = Fp.mul(c1, r1);
        const o0 = Fp.sub(t1, t2);
        const o1 = Fp.sub(Fp.mul(Fp.add(c0, c1), Fp.add(r0, r1)), Fp.add(t1, t2));
        return { c0: o0, c1: o1 };
    }
    sqr({ c0, c1 }) {
        const { Fp } = this;
        const a = Fp.add(c0, c1);
        const b = Fp.sub(c0, c1);
        const c = Fp.add(c0, c0);
        return { c0: Fp.mul(a, b), c1: Fp.mul(c, c1) };
    }
    addN(a, b) {
        return this.add(a, b);
    }
    subN(a, b) {
        return this.sub(a, b);
    }
    mulN(a, b) {
        return this.mul(a, b);
    }
    sqrN(a) {
        return this.sqr(a);
    }
    div(lhs, rhs) {
        const { Fp } = this;
        return this.mul(lhs, typeof rhs === 'bigint' ? Fp.inv(Fp.create(rhs)) : this.inv(rhs));
    }
    inv({ c0: a, c1: b }) {
        const { Fp } = this;
        const factor = Fp.inv(Fp.create(a * a + b * b));
        return { c0: Fp.mul(factor, Fp.create(a)), c1: Fp.mul(factor, Fp.create(-b)) };
    }
    sqrt(num) {
        const { Fp } = this;
        const Fp2 = this;
        const { c0, c1 } = num;
        if (Fp.is0(c1)) {
            if (mod.FpLegendre(Fp, c0) === 1)
                return Fp2.create({ c0: Fp.sqrt(c0), c1: Fp.ZERO });
            else
                return Fp2.create({ c0: Fp.ZERO, c1: Fp.sqrt(Fp.div(c0, this.Fp_NONRESIDUE)) });
        }
        const a = Fp.sqrt(Fp.sub(Fp.sqr(c0), Fp.mul(Fp.sqr(c1), this.Fp_NONRESIDUE)));
        let d = Fp.mul(Fp.add(a, c0), this.Fp_div2);
        const legendre = mod.FpLegendre(Fp, d);
        if (legendre === -1)
            d = Fp.sub(d, a);
        const a0 = Fp.sqrt(d);
        const candidateSqrt = Fp2.create({ c0: a0, c1: Fp.div(Fp.mul(c1, this.Fp_div2), a0) });
        if (!Fp2.eql(Fp2.sqr(candidateSqrt), num))
            throw new Error('Cannot find square root');
        const x1 = candidateSqrt;
        const x2 = Fp2.neg(x1);
        const { re: re1, im: im1 } = Fp2.reim(x1);
        const { re: re2, im: im2 } = Fp2.reim(x2);
        if (im1 > im2 || (im1 === im2 && re1 > re2))
            return x1;
        return x2;
    }
    isOdd(x) {
        const { re: x0, im: x1 } = this.reim(x);
        const sign_0 = x0 % _2n;
        const zero_0 = x0 === _0n;
        const sign_1 = x1 % _2n;
        return BigInt(sign_0 || (zero_0 && sign_1)) == _1n;
    }
    fromBytes(b) {
        const { Fp } = this;
        if (b.length !== this.BYTES)
            throw new Error('fromBytes invalid length=' + b.length);
        return { c0: Fp.fromBytes(b.subarray(0, Fp.BYTES)), c1: Fp.fromBytes(b.subarray(Fp.BYTES)) };
    }
    toBytes({ c0, c1 }) {
        return concatBytes(this.Fp.toBytes(c0), this.Fp.toBytes(c1));
    }
    cmov({ c0, c1 }, { c0: r0, c1: r1 }, c) {
        return {
            c0: this.Fp.cmov(c0, r0, c),
            c1: this.Fp.cmov(c1, r1, c),
        };
    }
    reim({ c0, c1 }) {
        return { re: c0, im: c1 };
    }
    Fp4Square(a, b) {
        const Fp2 = this;
        const a2 = Fp2.sqr(a);
        const b2 = Fp2.sqr(b);
        return {
            first: Fp2.add(Fp2.mulByNonresidue(b2), a2),
            second: Fp2.sub(Fp2.sub(Fp2.sqr(Fp2.add(a, b)), a2), b2),
        };
    }
    mulByNonresidue({ c0, c1 }) {
        return this.mul({ c0, c1 }, this.NONRESIDUE);
    }
    frobeniusMap({ c0, c1 }, power) {
        return {
            c0,
            c1: this.Fp.mul(c1, this.FROBENIUS_COEFFICIENTS[power % 2]),
        };
    }
}
class _Field6 {
    ORDER;
    BITS;
    BYTES;
    isLE;
    MASK = _1n;
    ZERO;
    ONE;
    Fp2;
    FROBENIUS_COEFFICIENTS_1;
    FROBENIUS_COEFFICIENTS_2;
    constructor(Fp2) {
        this.Fp2 = Fp2;
        this.ORDER = Fp2.ORDER;
        this.BITS = 3 * Fp2.BITS;
        this.BYTES = 3 * Fp2.BYTES;
        this.isLE = Fp2.isLE;
        this.ZERO = { c0: Fp2.ZERO, c1: Fp2.ZERO, c2: Fp2.ZERO };
        this.ONE = { c0: Fp2.ONE, c1: Fp2.ZERO, c2: Fp2.ZERO };
        const { Fp } = Fp2;
        const frob = calcFrobeniusCoefficients(Fp2, Fp2.NONRESIDUE, Fp.ORDER, 6, 2, 3);
        this.FROBENIUS_COEFFICIENTS_1 = frob[0];
        this.FROBENIUS_COEFFICIENTS_2 = frob[1];
        Object.seal(this);
    }
    add({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
        const { Fp2 } = this;
        return {
            c0: Fp2.add(c0, r0),
            c1: Fp2.add(c1, r1),
            c2: Fp2.add(c2, r2),
        };
    }
    sub({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
        const { Fp2 } = this;
        return {
            c0: Fp2.sub(c0, r0),
            c1: Fp2.sub(c1, r1),
            c2: Fp2.sub(c2, r2),
        };
    }
    mul({ c0, c1, c2 }, rhs) {
        const { Fp2 } = this;
        if (typeof rhs === 'bigint') {
            return {
                c0: Fp2.mul(c0, rhs),
                c1: Fp2.mul(c1, rhs),
                c2: Fp2.mul(c2, rhs),
            };
        }
        const { c0: r0, c1: r1, c2: r2 } = rhs;
        const t0 = Fp2.mul(c0, r0);
        const t1 = Fp2.mul(c1, r1);
        const t2 = Fp2.mul(c2, r2);
        return {
            c0: Fp2.add(t0, Fp2.mulByNonresidue(Fp2.sub(Fp2.mul(Fp2.add(c1, c2), Fp2.add(r1, r2)), Fp2.add(t1, t2)))),
            c1: Fp2.add(Fp2.sub(Fp2.mul(Fp2.add(c0, c1), Fp2.add(r0, r1)), Fp2.add(t0, t1)), Fp2.mulByNonresidue(t2)),
            c2: Fp2.sub(Fp2.add(t1, Fp2.mul(Fp2.add(c0, c2), Fp2.add(r0, r2))), Fp2.add(t0, t2)),
        };
    }
    sqr({ c0, c1, c2 }) {
        const { Fp2 } = this;
        let t0 = Fp2.sqr(c0);
        let t1 = Fp2.mul(Fp2.mul(c0, c1), _2n);
        let t3 = Fp2.mul(Fp2.mul(c1, c2), _2n);
        let t4 = Fp2.sqr(c2);
        return {
            c0: Fp2.add(Fp2.mulByNonresidue(t3), t0),
            c1: Fp2.add(Fp2.mulByNonresidue(t4), t1),
            c2: Fp2.sub(Fp2.sub(Fp2.add(Fp2.add(t1, Fp2.sqr(Fp2.add(Fp2.sub(c0, c1), c2))), t3), t0), t4),
        };
    }
    addN(a, b) {
        return this.add(a, b);
    }
    subN(a, b) {
        return this.sub(a, b);
    }
    mulN(a, b) {
        return this.mul(a, b);
    }
    sqrN(a) {
        return this.sqr(a);
    }
    create(num) {
        return num;
    }
    isValid({ c0, c1, c2 }) {
        const { Fp2 } = this;
        return Fp2.isValid(c0) && Fp2.isValid(c1) && Fp2.isValid(c2);
    }
    is0({ c0, c1, c2 }) {
        const { Fp2 } = this;
        return Fp2.is0(c0) && Fp2.is0(c1) && Fp2.is0(c2);
    }
    isValidNot0(num) {
        return !this.is0(num) && this.isValid(num);
    }
    neg({ c0, c1, c2 }) {
        const { Fp2 } = this;
        return { c0: Fp2.neg(c0), c1: Fp2.neg(c1), c2: Fp2.neg(c2) };
    }
    eql({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
        const { Fp2 } = this;
        return Fp2.eql(c0, r0) && Fp2.eql(c1, r1) && Fp2.eql(c2, r2);
    }
    sqrt(_) {
        return notImplemented();
    }
    div(lhs, rhs) {
        const { Fp2 } = this;
        const { Fp } = Fp2;
        return this.mul(lhs, typeof rhs === 'bigint' ? Fp.inv(Fp.create(rhs)) : this.inv(rhs));
    }
    pow(num, power) {
        return mod.FpPow(this, num, power);
    }
    invertBatch(nums) {
        return mod.FpInvertBatch(this, nums);
    }
    inv({ c0, c1, c2 }) {
        const { Fp2 } = this;
        let t0 = Fp2.sub(Fp2.sqr(c0), Fp2.mulByNonresidue(Fp2.mul(c2, c1)));
        let t1 = Fp2.sub(Fp2.mulByNonresidue(Fp2.sqr(c2)), Fp2.mul(c0, c1));
        let t2 = Fp2.sub(Fp2.sqr(c1), Fp2.mul(c0, c2));
        let t4 = Fp2.inv(Fp2.add(Fp2.mulByNonresidue(Fp2.add(Fp2.mul(c2, t1), Fp2.mul(c1, t2))), Fp2.mul(c0, t0)));
        return { c0: Fp2.mul(t4, t0), c1: Fp2.mul(t4, t1), c2: Fp2.mul(t4, t2) };
    }
    fromBytes(b) {
        const { Fp2 } = this;
        if (b.length !== this.BYTES)
            throw new Error('fromBytes invalid length=' + b.length);
        const B2 = Fp2.BYTES;
        return {
            c0: Fp2.fromBytes(b.subarray(0, B2)),
            c1: Fp2.fromBytes(b.subarray(B2, B2 * 2)),
            c2: Fp2.fromBytes(b.subarray(2 * B2)),
        };
    }
    toBytes({ c0, c1, c2 }) {
        const { Fp2 } = this;
        return concatBytes(Fp2.toBytes(c0), Fp2.toBytes(c1), Fp2.toBytes(c2));
    }
    cmov({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }, c) {
        const { Fp2 } = this;
        return {
            c0: Fp2.cmov(c0, r0, c),
            c1: Fp2.cmov(c1, r1, c),
            c2: Fp2.cmov(c2, r2, c),
        };
    }
    fromBigSix(t) {
        const { Fp2 } = this;
        if (!Array.isArray(t) || t.length !== 6)
            throw new Error('invalid Fp6 usage');
        return {
            c0: Fp2.fromBigTuple(t.slice(0, 2)),
            c1: Fp2.fromBigTuple(t.slice(2, 4)),
            c2: Fp2.fromBigTuple(t.slice(4, 6)),
        };
    }
    frobeniusMap({ c0, c1, c2 }, power) {
        const { Fp2 } = this;
        return {
            c0: Fp2.frobeniusMap(c0, power),
            c1: Fp2.mul(Fp2.frobeniusMap(c1, power), this.FROBENIUS_COEFFICIENTS_1[power % 6]),
            c2: Fp2.mul(Fp2.frobeniusMap(c2, power), this.FROBENIUS_COEFFICIENTS_2[power % 6]),
        };
    }
    mulByFp2({ c0, c1, c2 }, rhs) {
        const { Fp2 } = this;
        return {
            c0: Fp2.mul(c0, rhs),
            c1: Fp2.mul(c1, rhs),
            c2: Fp2.mul(c2, rhs),
        };
    }
    mulByNonresidue({ c0, c1, c2 }) {
        const { Fp2 } = this;
        return { c0: Fp2.mulByNonresidue(c2), c1: c0, c2: c1 };
    }
    mul1({ c0, c1, c2 }, b1) {
        const { Fp2 } = this;
        return {
            c0: Fp2.mulByNonresidue(Fp2.mul(c2, b1)),
            c1: Fp2.mul(c0, b1),
            c2: Fp2.mul(c1, b1),
        };
    }
    mul01({ c0, c1, c2 }, b0, b1) {
        const { Fp2 } = this;
        let t0 = Fp2.mul(c0, b0);
        let t1 = Fp2.mul(c1, b1);
        return {
            c0: Fp2.add(Fp2.mulByNonresidue(Fp2.sub(Fp2.mul(Fp2.add(c1, c2), b1), t1)), t0),
            c1: Fp2.sub(Fp2.sub(Fp2.mul(Fp2.add(b0, b1), Fp2.add(c0, c1)), t0), t1),
            c2: Fp2.add(Fp2.sub(Fp2.mul(Fp2.add(c0, c2), b0), t0), t1),
        };
    }
}
class _Field12 {
    ORDER;
    BITS;
    BYTES;
    isLE;
    MASK = _1n;
    ZERO;
    ONE;
    Fp6;
    FROBENIUS_COEFFICIENTS;
    X_LEN;
    finalExponentiate;
    constructor(Fp6, opts) {
        const { Fp2 } = Fp6;
        const { Fp } = Fp2;
        this.Fp6 = Fp6;
        this.ORDER = Fp2.ORDER;
        this.BITS = 2 * Fp6.BITS;
        this.BYTES = 2 * Fp6.BYTES;
        this.isLE = Fp6.isLE;
        this.ZERO = { c0: Fp6.ZERO, c1: Fp6.ZERO };
        this.ONE = { c0: Fp6.ONE, c1: Fp6.ZERO };
        this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp2, Fp2.NONRESIDUE, Fp.ORDER, 12, 1, 6)[0];
        this.X_LEN = opts.X_LEN;
        this.finalExponentiate = opts.Fp12finalExponentiate;
    }
    create(num) {
        return num;
    }
    isValid({ c0, c1 }) {
        const { Fp6 } = this;
        return Fp6.isValid(c0) && Fp6.isValid(c1);
    }
    is0({ c0, c1 }) {
        const { Fp6 } = this;
        return Fp6.is0(c0) && Fp6.is0(c1);
    }
    isValidNot0(num) {
        return !this.is0(num) && this.isValid(num);
    }
    neg({ c0, c1 }) {
        const { Fp6 } = this;
        return { c0: Fp6.neg(c0), c1: Fp6.neg(c1) };
    }
    eql({ c0, c1 }, { c0: r0, c1: r1 }) {
        const { Fp6 } = this;
        return Fp6.eql(c0, r0) && Fp6.eql(c1, r1);
    }
    sqrt(_) {
        notImplemented();
    }
    inv({ c0, c1 }) {
        const { Fp6 } = this;
        let t = Fp6.inv(Fp6.sub(Fp6.sqr(c0), Fp6.mulByNonresidue(Fp6.sqr(c1))));
        return { c0: Fp6.mul(c0, t), c1: Fp6.neg(Fp6.mul(c1, t)) };
    }
    div(lhs, rhs) {
        const { Fp6 } = this;
        const { Fp2 } = Fp6;
        const { Fp } = Fp2;
        return this.mul(lhs, typeof rhs === 'bigint' ? Fp.inv(Fp.create(rhs)) : this.inv(rhs));
    }
    pow(num, power) {
        return mod.FpPow(this, num, power);
    }
    invertBatch(nums) {
        return mod.FpInvertBatch(this, nums);
    }
    add({ c0, c1 }, { c0: r0, c1: r1 }) {
        const { Fp6 } = this;
        return {
            c0: Fp6.add(c0, r0),
            c1: Fp6.add(c1, r1),
        };
    }
    sub({ c0, c1 }, { c0: r0, c1: r1 }) {
        const { Fp6 } = this;
        return {
            c0: Fp6.sub(c0, r0),
            c1: Fp6.sub(c1, r1),
        };
    }
    mul({ c0, c1 }, rhs) {
        const { Fp6 } = this;
        if (typeof rhs === 'bigint')
            return { c0: Fp6.mul(c0, rhs), c1: Fp6.mul(c1, rhs) };
        let { c0: r0, c1: r1 } = rhs;
        let t1 = Fp6.mul(c0, r0);
        let t2 = Fp6.mul(c1, r1);
        return {
            c0: Fp6.add(t1, Fp6.mulByNonresidue(t2)),
            c1: Fp6.sub(Fp6.mul(Fp6.add(c0, c1), Fp6.add(r0, r1)), Fp6.add(t1, t2)),
        };
    }
    sqr({ c0, c1 }) {
        const { Fp6 } = this;
        let ab = Fp6.mul(c0, c1);
        return {
            c0: Fp6.sub(Fp6.sub(Fp6.mul(Fp6.add(Fp6.mulByNonresidue(c1), c0), Fp6.add(c0, c1)), ab), Fp6.mulByNonresidue(ab)),
            c1: Fp6.add(ab, ab),
        };
    }
    addN(a, b) {
        return this.add(a, b);
    }
    subN(a, b) {
        return this.sub(a, b);
    }
    mulN(a, b) {
        return this.mul(a, b);
    }
    sqrN(a) {
        return this.sqr(a);
    }
    fromBytes(b) {
        const { Fp6 } = this;
        if (b.length !== this.BYTES)
            throw new Error('fromBytes invalid length=' + b.length);
        return {
            c0: Fp6.fromBytes(b.subarray(0, Fp6.BYTES)),
            c1: Fp6.fromBytes(b.subarray(Fp6.BYTES)),
        };
    }
    toBytes({ c0, c1 }) {
        const { Fp6 } = this;
        return concatBytes(Fp6.toBytes(c0), Fp6.toBytes(c1));
    }
    cmov({ c0, c1 }, { c0: r0, c1: r1 }, c) {
        const { Fp6 } = this;
        return {
            c0: Fp6.cmov(c0, r0, c),
            c1: Fp6.cmov(c1, r1, c),
        };
    }
    fromBigTwelve(t) {
        const { Fp6 } = this;
        return {
            c0: Fp6.fromBigSix(t.slice(0, 6)),
            c1: Fp6.fromBigSix(t.slice(6, 12)),
        };
    }
    frobeniusMap(lhs, power) {
        const { Fp6 } = this;
        const { Fp2 } = Fp6;
        const { c0, c1, c2 } = Fp6.frobeniusMap(lhs.c1, power);
        const coeff = this.FROBENIUS_COEFFICIENTS[power % 12];
        return {
            c0: Fp6.frobeniusMap(lhs.c0, power),
            c1: Fp6.create({
                c0: Fp2.mul(c0, coeff),
                c1: Fp2.mul(c1, coeff),
                c2: Fp2.mul(c2, coeff),
            }),
        };
    }
    mulByFp2({ c0, c1 }, rhs) {
        const { Fp6 } = this;
        return {
            c0: Fp6.mulByFp2(c0, rhs),
            c1: Fp6.mulByFp2(c1, rhs),
        };
    }
    conjugate({ c0, c1 }) {
        return { c0, c1: this.Fp6.neg(c1) };
    }
    mul014({ c0, c1 }, o0, o1, o4) {
        const { Fp6 } = this;
        const { Fp2 } = Fp6;
        let t0 = Fp6.mul01(c0, o0, o1);
        let t1 = Fp6.mul1(c1, o4);
        return {
            c0: Fp6.add(Fp6.mulByNonresidue(t1), t0),
            c1: Fp6.sub(Fp6.sub(Fp6.mul01(Fp6.add(c1, c0), o0, Fp2.add(o1, o4)), t0), t1),
        };
    }
    mul034({ c0, c1 }, o0, o3, o4) {
        const { Fp6 } = this;
        const { Fp2 } = Fp6;
        const a = Fp6.create({
            c0: Fp2.mul(c0.c0, o0),
            c1: Fp2.mul(c0.c1, o0),
            c2: Fp2.mul(c0.c2, o0),
        });
        const b = Fp6.mul01(c1, o3, o4);
        const e = Fp6.mul01(Fp6.add(c0, c1), Fp2.add(o0, o3), o4);
        return {
            c0: Fp6.add(Fp6.mulByNonresidue(b), a),
            c1: Fp6.sub(e, Fp6.add(a, b)),
        };
    }
    _cyclotomicSquare({ c0, c1 }) {
        const { Fp6 } = this;
        const { Fp2 } = Fp6;
        const { c0: c0c0, c1: c0c1, c2: c0c2 } = c0;
        const { c0: c1c0, c1: c1c1, c2: c1c2 } = c1;
        const { first: t3, second: t4 } = Fp2.Fp4Square(c0c0, c1c1);
        const { first: t5, second: t6 } = Fp2.Fp4Square(c1c0, c0c2);
        const { first: t7, second: t8 } = Fp2.Fp4Square(c0c1, c1c2);
        const t9 = Fp2.mulByNonresidue(t8);
        return {
            c0: Fp6.create({
                c0: Fp2.add(Fp2.mul(Fp2.sub(t3, c0c0), _2n), t3),
                c1: Fp2.add(Fp2.mul(Fp2.sub(t5, c0c1), _2n), t5),
                c2: Fp2.add(Fp2.mul(Fp2.sub(t7, c0c2), _2n), t7),
            }),
            c1: Fp6.create({
                c0: Fp2.add(Fp2.mul(Fp2.add(t9, c1c0), _2n), t9),
                c1: Fp2.add(Fp2.mul(Fp2.add(t4, c1c1), _2n), t4),
                c2: Fp2.add(Fp2.mul(Fp2.add(t6, c1c2), _2n), t6),
            }),
        };
    }
    _cyclotomicExp(num, n) {
        let z = this.ONE;
        for (let i = this.X_LEN - 1; i >= 0; i--) {
            z = this._cyclotomicSquare(z);
            if (bitGet(n, i))
                z = this.mul(z, num);
        }
        return z;
    }
}
export function tower12(opts) {
    const Fp = mod.Field(opts.ORDER);
    const Fp2 = new _Field2(Fp, opts);
    const Fp6 = new _Field6(Fp2);
    const Fp12 = new _Field12(Fp6, opts);
    return { Fp, Fp2, Fp6, Fp12 };
}
