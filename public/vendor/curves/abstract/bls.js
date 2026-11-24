import { abytes, ensureBytes, memoized, randomBytes, } from '../utils.js';
import { normalizeZ } from './curve.js';
import { createHasher, } from './hash-to-curve.js';
import { getMinHashLength, mapHashToField } from './modular.js';
import { _normFnElement, weierstrassPoints, } from './weierstrass.js';
const _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _3n = BigInt(3);
function NAfDecomposition(a) {
    const res = [];
    for (; a > _1n; a >>= _1n) {
        if ((a & _1n) === _0n)
            res.unshift(0);
        else if ((a & _3n) === _3n) {
            res.unshift(-1);
            a += _1n;
        }
        else
            res.unshift(1);
    }
    return res;
}
function aNonEmpty(arr) {
    if (!Array.isArray(arr) || arr.length === 0)
        throw new Error('expected non-empty array');
}
function createBlsPairing(fields, G1, G2, params) {
    const { Fp2, Fp12 } = fields;
    const { twistType, ateLoopSize, xNegative, postPrecompute } = params;
    let lineFunction;
    if (twistType === 'multiplicative') {
        lineFunction = (c0, c1, c2, f, Px, Py) => Fp12.mul014(f, c0, Fp2.mul(c1, Px), Fp2.mul(c2, Py));
    }
    else if (twistType === 'divisive') {
        lineFunction = (c0, c1, c2, f, Px, Py) => Fp12.mul034(f, Fp2.mul(c2, Py), Fp2.mul(c1, Px), c0);
    }
    else
        throw new Error('bls: unknown twist type');
    const Fp2div2 = Fp2.div(Fp2.ONE, Fp2.mul(Fp2.ONE, _2n));
    function pointDouble(ell, Rx, Ry, Rz) {
        const t0 = Fp2.sqr(Ry);
        const t1 = Fp2.sqr(Rz);
        const t2 = Fp2.mulByB(Fp2.mul(t1, _3n));
        const t3 = Fp2.mul(t2, _3n);
        const t4 = Fp2.sub(Fp2.sub(Fp2.sqr(Fp2.add(Ry, Rz)), t1), t0);
        const c0 = Fp2.sub(t2, t0);
        const c1 = Fp2.mul(Fp2.sqr(Rx), _3n);
        const c2 = Fp2.neg(t4);
        ell.push([c0, c1, c2]);
        Rx = Fp2.mul(Fp2.mul(Fp2.mul(Fp2.sub(t0, t3), Rx), Ry), Fp2div2);
        Ry = Fp2.sub(Fp2.sqr(Fp2.mul(Fp2.add(t0, t3), Fp2div2)), Fp2.mul(Fp2.sqr(t2), _3n));
        Rz = Fp2.mul(t0, t4);
        return { Rx, Ry, Rz };
    }
    function pointAdd(ell, Rx, Ry, Rz, Qx, Qy) {
        const t0 = Fp2.sub(Ry, Fp2.mul(Qy, Rz));
        const t1 = Fp2.sub(Rx, Fp2.mul(Qx, Rz));
        const c0 = Fp2.sub(Fp2.mul(t0, Qx), Fp2.mul(t1, Qy));
        const c1 = Fp2.neg(t0);
        const c2 = t1;
        ell.push([c0, c1, c2]);
        const t2 = Fp2.sqr(t1);
        const t3 = Fp2.mul(t2, t1);
        const t4 = Fp2.mul(t2, Rx);
        const t5 = Fp2.add(Fp2.sub(t3, Fp2.mul(t4, _2n)), Fp2.mul(Fp2.sqr(t0), Rz));
        Rx = Fp2.mul(t1, t5);
        Ry = Fp2.sub(Fp2.mul(Fp2.sub(t4, t5), t0), Fp2.mul(t3, Ry));
        Rz = Fp2.mul(Rz, t3);
        return { Rx, Ry, Rz };
    }
    const ATE_NAF = NAfDecomposition(ateLoopSize);
    const calcPairingPrecomputes = memoized((point) => {
        const p = point;
        const { x, y } = p.toAffine();
        const Qx = x, Qy = y, negQy = Fp2.neg(y);
        let Rx = Qx, Ry = Qy, Rz = Fp2.ONE;
        const ell = [];
        for (const bit of ATE_NAF) {
            const cur = [];
            ({ Rx, Ry, Rz } = pointDouble(cur, Rx, Ry, Rz));
            if (bit)
                ({ Rx, Ry, Rz } = pointAdd(cur, Rx, Ry, Rz, Qx, bit === -1 ? negQy : Qy));
            ell.push(cur);
        }
        if (postPrecompute) {
            const last = ell[ell.length - 1];
            postPrecompute(Rx, Ry, Rz, Qx, Qy, pointAdd.bind(null, last));
        }
        return ell;
    });
    function millerLoopBatch(pairs, withFinalExponent = false) {
        let f12 = Fp12.ONE;
        if (pairs.length) {
            const ellLen = pairs[0][0].length;
            for (let i = 0; i < ellLen; i++) {
                f12 = Fp12.sqr(f12);
                for (const [ell, Px, Py] of pairs) {
                    for (const [c0, c1, c2] of ell[i])
                        f12 = lineFunction(c0, c1, c2, f12, Px, Py);
                }
            }
        }
        if (xNegative)
            f12 = Fp12.conjugate(f12);
        return withFinalExponent ? Fp12.finalExponentiate(f12) : f12;
    }
    function pairingBatch(pairs, withFinalExponent = true) {
        const res = [];
        normalizeZ(G1, pairs.map(({ g1 }) => g1));
        normalizeZ(G2, pairs.map(({ g2 }) => g2));
        for (const { g1, g2 } of pairs) {
            if (g1.is0() || g2.is0())
                throw new Error('pairing is not available for ZERO point');
            g1.assertValidity();
            g2.assertValidity();
            const Qa = g1.toAffine();
            res.push([calcPairingPrecomputes(g2), Qa.x, Qa.y]);
        }
        return millerLoopBatch(res, withFinalExponent);
    }
    function pairing(Q, P, withFinalExponent = true) {
        return pairingBatch([{ g1: Q, g2: P }], withFinalExponent);
    }
    return {
        Fp12,
        millerLoopBatch,
        pairing,
        pairingBatch,
        calcPairingPrecomputes,
    };
}
function createBlsSig(blsPairing, PubCurve, SigCurve, SignatureCoder, isSigG1) {
    const { Fp12, pairingBatch } = blsPairing;
    function normPub(point) {
        return point instanceof PubCurve.Point ? point : PubCurve.Point.fromHex(point);
    }
    function normSig(point) {
        return point instanceof SigCurve.Point ? point : SigCurve.Point.fromHex(point);
    }
    function amsg(m) {
        if (!(m instanceof SigCurve.Point))
            throw new Error(`expected valid message hashed to ${!isSigG1 ? 'G2' : 'G1'} curve`);
        return m;
    }
    const pair = !isSigG1
        ? (a, b) => ({ g1: a, g2: b })
        : (a, b) => ({ g1: b, g2: a });
    return {
        getPublicKey(secretKey) {
            const sec = _normFnElement(PubCurve.Point.Fn, secretKey);
            return PubCurve.Point.BASE.multiply(sec);
        },
        sign(message, secretKey, unusedArg) {
            if (unusedArg != null)
                throw new Error('sign() expects 2 arguments');
            const sec = _normFnElement(PubCurve.Point.Fn, secretKey);
            amsg(message).assertValidity();
            return message.multiply(sec);
        },
        verify(signature, message, publicKey, unusedArg) {
            if (unusedArg != null)
                throw new Error('verify() expects 3 arguments');
            signature = normSig(signature);
            publicKey = normPub(publicKey);
            const P = publicKey.negate();
            const G = PubCurve.Point.BASE;
            const Hm = amsg(message);
            const S = signature;
            const exp = pairingBatch([pair(P, Hm), pair(G, S)]);
            return Fp12.eql(exp, Fp12.ONE);
        },
        verifyBatch(signature, messages, publicKeys) {
            aNonEmpty(messages);
            if (publicKeys.length !== messages.length)
                throw new Error('amount of public keys and messages should be equal');
            const sig = normSig(signature);
            const nMessages = messages;
            const nPublicKeys = publicKeys.map(normPub);
            const messagePubKeyMap = new Map();
            for (let i = 0; i < nPublicKeys.length; i++) {
                const pub = nPublicKeys[i];
                const msg = nMessages[i];
                let keys = messagePubKeyMap.get(msg);
                if (keys === undefined) {
                    keys = [];
                    messagePubKeyMap.set(msg, keys);
                }
                keys.push(pub);
            }
            const paired = [];
            const G = PubCurve.Point.BASE;
            try {
                for (const [msg, keys] of messagePubKeyMap) {
                    const groupPublicKey = keys.reduce((acc, msg) => acc.add(msg));
                    paired.push(pair(groupPublicKey, msg));
                }
                paired.push(pair(G.negate(), sig));
                return Fp12.eql(pairingBatch(paired), Fp12.ONE);
            }
            catch {
                return false;
            }
        },
        aggregatePublicKeys(publicKeys) {
            aNonEmpty(publicKeys);
            publicKeys = publicKeys.map((pub) => normPub(pub));
            const agg = publicKeys.reduce((sum, p) => sum.add(p), PubCurve.Point.ZERO);
            agg.assertValidity();
            return agg;
        },
        aggregateSignatures(signatures) {
            aNonEmpty(signatures);
            signatures = signatures.map((sig) => normSig(sig));
            const agg = signatures.reduce((sum, s) => sum.add(s), SigCurve.Point.ZERO);
            agg.assertValidity();
            return agg;
        },
        hash(messageBytes, DST) {
            abytes(messageBytes);
            const opts = DST ? { DST } : undefined;
            return SigCurve.hashToCurve(messageBytes, opts);
        },
        Signature: SignatureCoder,
    };
}
export function bls(CURVE) {
    const { Fp, Fr, Fp2, Fp6, Fp12 } = CURVE.fields;
    const G1_ = weierstrassPoints(CURVE.G1);
    const G1 = Object.assign(G1_, createHasher(G1_.Point, CURVE.G1.mapToCurve, {
        ...CURVE.htfDefaults,
        ...CURVE.G1.htfDefaults,
    }));
    const G2_ = weierstrassPoints(CURVE.G2);
    const G2 = Object.assign(G2_, createHasher(G2_.Point, CURVE.G2.mapToCurve, {
        ...CURVE.htfDefaults,
        ...CURVE.G2.htfDefaults,
    }));
    const pairingRes = createBlsPairing(CURVE.fields, G1.Point, G2.Point, {
        ...CURVE.params,
        postPrecompute: CURVE.postPrecompute,
    });
    const { millerLoopBatch, pairing, pairingBatch, calcPairingPrecomputes } = pairingRes;
    const longSignatures = createBlsSig(pairingRes, G1, G2, CURVE.G2.Signature, false);
    const shortSignatures = createBlsSig(pairingRes, G2, G1, CURVE.G1.ShortSignature, true);
    const rand = CURVE.randomBytes || randomBytes;
    const randomSecretKey = () => {
        const length = getMinHashLength(Fr.ORDER);
        return mapHashToField(rand(length), Fr.ORDER);
    };
    const utils = {
        randomSecretKey,
        randomPrivateKey: randomSecretKey,
        calcPairingPrecomputes,
    };
    const { ShortSignature } = CURVE.G1;
    const { Signature } = CURVE.G2;
    function normP1Hash(point, htfOpts) {
        return point instanceof G1.Point
            ? point
            : shortSignatures.hash(ensureBytes('point', point), htfOpts?.DST);
    }
    function normP2Hash(point, htfOpts) {
        return point instanceof G2.Point
            ? point
            : longSignatures.hash(ensureBytes('point', point), htfOpts?.DST);
    }
    function getPublicKey(privateKey) {
        return longSignatures.getPublicKey(privateKey).toBytes(true);
    }
    function getPublicKeyForShortSignatures(privateKey) {
        return shortSignatures.getPublicKey(privateKey).toBytes(true);
    }
    function sign(message, privateKey, htfOpts) {
        const Hm = normP2Hash(message, htfOpts);
        const S = longSignatures.sign(Hm, privateKey);
        return message instanceof G2.Point ? S : Signature.toBytes(S);
    }
    function signShortSignature(message, privateKey, htfOpts) {
        const Hm = normP1Hash(message, htfOpts);
        const S = shortSignatures.sign(Hm, privateKey);
        return message instanceof G1.Point ? S : ShortSignature.toBytes(S);
    }
    function verify(signature, message, publicKey, htfOpts) {
        const Hm = normP2Hash(message, htfOpts);
        return longSignatures.verify(signature, Hm, publicKey);
    }
    function verifyShortSignature(signature, message, publicKey, htfOpts) {
        const Hm = normP1Hash(message, htfOpts);
        return shortSignatures.verify(signature, Hm, publicKey);
    }
    function aggregatePublicKeys(publicKeys) {
        const agg = longSignatures.aggregatePublicKeys(publicKeys);
        return publicKeys[0] instanceof G1.Point ? agg : agg.toBytes(true);
    }
    function aggregateSignatures(signatures) {
        const agg = longSignatures.aggregateSignatures(signatures);
        return signatures[0] instanceof G2.Point ? agg : Signature.toBytes(agg);
    }
    function aggregateShortSignatures(signatures) {
        const agg = shortSignatures.aggregateSignatures(signatures);
        return signatures[0] instanceof G1.Point ? agg : ShortSignature.toBytes(agg);
    }
    function verifyBatch(signature, messages, publicKeys, htfOpts) {
        const Hm = messages.map((m) => normP2Hash(m, htfOpts));
        return longSignatures.verifyBatch(signature, Hm, publicKeys);
    }
    G1.Point.BASE.precompute(4);
    return {
        longSignatures,
        shortSignatures,
        millerLoopBatch,
        pairing,
        pairingBatch,
        verifyBatch,
        fields: {
            Fr,
            Fp,
            Fp2,
            Fp6,
            Fp12,
        },
        params: {
            ateLoopSize: CURVE.params.ateLoopSize,
            twistType: CURVE.params.twistType,
            r: CURVE.params.r,
            G1b: CURVE.G1.b,
            G2b: CURVE.G2.b,
        },
        utils,
        getPublicKey,
        getPublicKeyForShortSignatures,
        sign,
        signShortSignature,
        verify,
        verifyShortSignature,
        aggregatePublicKeys,
        aggregateSignatures,
        aggregateShortSignatures,
        G1,
        G2,
        Signature,
        ShortSignature,
    };
}
