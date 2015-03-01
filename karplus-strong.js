// this was derived experimentally to match Andre Michelle's
// I've no idea how it works out as this...
// it doesn't seem to appear in the code anywhere
var timeUnit = 0.12;

// === resonate ===

// samples: a Float32Array containing samples to apply
// to a guitar body
function resonate(samples) {
    // asm.js requires all data in/out of function to
    // be done through heap object
    // from the asm.js spec, it sounds like the heap must be
    // passed in as a plain ArrayBuffer
    // (.buffer is the ArrayBuffer referenced by the Float32Buffer)
    var heapBuffer = samples.buffer;
    var asm = asmFunctions(window, null, heapBuffer);
    asm.simpleBody();

    // standard asm.js block
    // stdlib: object through which standard library functions are called
    // foreign: object through which external javascript functions are called
    // heap: buffer used for all data in/out of function
    function asmFunctions(stdlib, foreign, heapBuffer) {
        "use asm";

        // heap is supposed to come in as just an ArrayBuffer
        // so first need to get a Float32 of it
        var heap = new Float32Array(heapBuffer);

        // this is copied verbatim from the original ActionScript source
        // haven't figured out how it works yet
        function simpleBody() {
            var r00, f00, r10, f10, f0,
                c0, c1, r0, r1;
            r00 = f00 = r10 = f10 = f0 = f1 = 0.0;
            c0 = 2 * Math.sin(Math.PI * 3.4375 / 44100);
            c1 = 2 * Math.sin(Math.PI * 6.124928687214833 / 44100);
            r0 = 0.98;
            r1 = 0.98;
            for (var i = 0; i < heap.length; i++) {
                var curSample = heap[i];
                r00 = r00 * r0;
                r00 = r00 + (f0 - f00) * c0;
                f00 = f00 + r00;
                f00 = f00 - f00 * f00 * f00 * 0.166666666666666;
                r10 = r10 * r1;
                r10 = r10 + (f0 - f10) * c1;
                f10 = f10 + r10;
                f10 = f10 - f10 * f10 * f10 * 0.166666666666666;
                f0 = heap[i];
                heap[i] = f0 + (f00 + f10) * 2;
            }
        }

        return {
            simpleBody: simpleBody
        };
    }
}

// === GuitarString ===

function GuitarString(audioCtx, stringN, octave, semitone) {
    this.audioCtx = audioCtx;
    this.basicHz = GuitarString.C0_HZ * Math.pow(2, octave+semitone/12);
    this.basicHz = this.basicHz.toFixed(2);

    // this is only used in a magical calculation of filter coefficients
    this.semitoneIndex = octave*12 + semitone - 9;
    // also magic, used for stereo spread
    // from -1 for first string to +1 for last
    this.prePan = (stringN - 2.5) * 0.4;
    
    var basicPeriod = 1/this.basicHz;
    var basicPeriodSamples = Math.round(basicPeriod * audioCtx.sampleRate);
    this.seedNoise = generateSeedNoise(65535, basicPeriodSamples);

    function generateSeedNoise(seed, samples) {
        var noiseArray = new Float32Array(samples);
        for (var i = 0; i < samples; i++) {
            // taken directly from ActionScript
            var _loc1_ = 16807 * (seed & 65535);
            var _loc2_ = 16807 * (seed >> 16);
            _loc1_ = _loc1_ + ((_loc2_ & 32767) << 16);
            _loc1_ = _loc1_ + (_loc2_ >> 15);
            if (_loc1_ > 4.151801719E9)
            {
                _loc1_ = _loc1_ - 4.151801719E9;
            }
            var rand = (seed = _loc1_) / 4.151801719E9 * 2 - 1;
            noiseArray[i] = rand;
        }
        return noiseArray;
    }
}

// work from A0 as a reference,
// since it has a nice round frequency
GuitarString.A0_HZ = 27.5;
// an increase in octave by 1 doubles the frequency
// each octave is divided into 12 semitones
// the scale goes C0, C0#, D0, D0#, E0, F0, F0#, G0, G0#, A0, A0#, B0
// so go back 9 semitones to get to C0
GuitarString.C0_HZ = GuitarString.A0_HZ * Math.pow(2, -9/12);

GuitarString.prototype.pluck = function(time, velocity, tab) {
    console.log(this.basicHz + " Hz string being plucked" +
                " with tab " + tab +
                " with velocity " + velocity +
                " at beat " + (time/timeUnit).toFixed(2) + 
                ", actual time " + this.audioCtx.currentTime);

    var bufferSource = this.audioCtx.createBufferSource();
    var channels = 2;
    // 1 second buffer
    var frameCount = audioCtx.sampleRate;
    var sampleRate = audioCtx.sampleRate;
    var buffer = this.audioCtx.createBuffer(channels, frameCount, sampleRate);

    var options = getOptions();
    var smoothingFactor = calculateSmoothingFactor(this, tab, options);
    var hz = this.basicHz * Math.pow(2, tab/12);

    asmWrapper(buffer, this.seedNoise, sampleRate, hz, smoothingFactor, velocity, options, this);
    if (options.body == "simple") {
        resonate(buffer.getChannelData(0));
        resonate(buffer.getChannelData(1));
    }

    bufferSource.buffer = buffer;
    bufferSource.connect(audioCtx.destination);
    // start playing at 'time'
    bufferSource.start(time);

    // calculate the constant used for the low-pass filter
    // used in the Karplus-Strong loop
    function calculateSmoothingFactor(string, tab, options) {
        var smoothingFactor;
        if (options.stringDampingCalculation == "direct") {
            smoothingFactor = options.stringDamping;
        } else if (options.stringDampingCalculation == "magic") {
            // this is copied verbatim from the flash one
            // is magical, don't know how it works
            var noteNumber = (string.semitoneIndex + tab - 19)/44;
            smoothingFactor = 
                options.stringDamping +
                Math.pow(noteNumber, 0.5) * (1 - options.stringDamping) * 0.5 +
                (1 - options.stringDamping) *
                    Math.random() *
                    options.stringDampingVariation;
        }
        return smoothingFactor;
    }

    function getOptions() {
        var stringTensionSlider =
            document.getElementById("stringTension");
        var stringTension = stringTensionSlider.valueAsNumber;

        var characterVariationSlider =
            document.getElementById("characterVariation");
        var characterVariation = characterVariationSlider.valueAsNumber;

        var stringDampingSlider =
            document.getElementById("stringDamping");
        var stringDamping = stringDampingSlider.valueAsNumber;

        var stringDampingVariationSlider =
            document.getElementById("stringDampingVariation");
        var stringDampingVariation = stringDampingVariationSlider.valueAsNumber;

        var pluckDampingSlider =
            document.getElementById("pluckDamping");
        var pluckDamping = pluckDampingSlider.valueAsNumber;

        var magicCalculationRadio =
            document.getElementById("magicCalculation");
        var directCalculationRadio =
            document.getElementById("directCalculation");
        var stringDampingCalculation;
        if (magicCalculationRadio.checked) {
            stringDampingCalculation = "magic";
        } else if (directCalculationRadio.checked) {
            stringDampingCalculation = "direct";
        }

        var noBodyRadio =
            document.getElementById("noBody");
        var simpleBodyRadio =
            document.getElementById("simpleBody");
        var body;
        if (noBodyRadio.checked) {
            body = "none";
        } else if (simpleBodyRadio.checked) {
            body = "simple";
        }

        var stereoSpreadSlider =
            document.getElementById("stereoSpread");
        var stereoSpread = stereoSpreadSlider.valueAsNumber;
        
        return {
            stringTension: stringTension,
            characterVariation: characterVariation,
            stringDamping: stringDamping,
            stringDampingVariation: stringDampingVariation,
            stringDampingCalculation: stringDampingCalculation,
            pluckDamping: pluckDamping,
            body: body,
            stereoSpread: stereoSpread
        };
    }

    // asm.js spec at http://asmjs.org/spec/latest/
    function asmWrapper(channelBuffer, seedNoise, sampleRate, hz, smoothingFactor, velocity, options, string) {
        var targetArrayL = channelBuffer.getChannelData(0);
        var targetArrayR = channelBuffer.getChannelData(1);

        var heapFloat32Size = seedNoise.length + 
                              targetArrayL.length +
                              targetArrayR.length;
        var heapFloat32 = new Float32Array(heapFloat32Size);
        var i;
        for (i = 0; i < seedNoise.length; i++) {
            heapFloat32[i] = seedNoise[i];
        }

        // from the asm.js spec, it sounds like the heap must be
        // passed in as a plain ArrayBuffer
        var heapBuffer = heapFloat32.buffer;
        var asm = asmFunctions(window, null, heapBuffer);

        var heapOffsets = {
            seedStart: 0,
            seedEnd: seedNoise.length - 1,
            targetStart: seedNoise.length,
            targetEnd: seedNoise.length + targetArrayL.length - 1
        };

        asm.renderKarplusStrong(heapOffsets,
                                sampleRate,
                                hz,
                                velocity,
                                smoothingFactor,
                                options.stringTension,
                                options.pluckDamping,
                                options.characterVariation);

        asm.fadeTails(heapOffsets.targetStart,
                heapOffsets.targetEnd - heapOffsets.targetStart + 1);
        
        /*
        asm.renderDecayedSine(heapOffsets,
                              sampleRate,
                              hz,
                              velocity);
        */

        // string.prePan is set individually for each string such that
        // the lowest note has a value of -1 and the highest +1
        var stereoSpread = options.stereoSpread * string.prePan;
        // for negative stereoSpreads, the note is pushed to the left
        // for positive stereoSpreads, the note is pushed to the right
        var gainL = (1 - stereoSpread) * 0.5;
        var gainR = (1 + stereoSpread) * 0.5;
        var clippingAvoidanceGain = 0.1;
        for (i = 0; i < targetArrayL.length; i++) {
            targetArrayL[i] = heapFloat32[heapOffsets.targetStart+i] * gainL;
            targetArrayL[i] *= clippingAvoidanceGain;
        }
        for (i = 0; i < targetArrayL.length; i++) {
            targetArrayR[i] = heapFloat32[heapOffsets.targetStart+i] * gainR;
            targetArrayR[i] *= clippingAvoidanceGain;
        }
    }

    function asmFunctions(stdlib, foreign, heapBuffer) {
        "use asm";

        // heap is supposed to come in as just an ArrayBuffer
        // so first need to get a Float32 of it
        var heap = new Float32Array(heapBuffer);

        function lowPass(lastOutput, currentInput, smoothingFactor) {
            var currentOutput = smoothingFactor * currentInput +
                (1 - smoothingFactor) * lastOutput;
            return currentOutput;
        }
        
        // apply a fade envelope to the end of a buffer
        // to make it end at zero ampltiude
        // (to avoid clicks heard when sample otherwise suddenly
        //  cuts off)
        function fadeTails(heapStart, length) {
            var tailProportion = 0.1;
            var tailSamples = Math.round(length * tailProportion);
            var tailSamplesStart = heapStart + length - tailSamples;

            for (var i = tailSamplesStart, samplesThroughTail = 0;
                    i < heapStart + length;
                    i++, samplesThroughTail++) {
                var proportionOfTail = samplesThroughTail / tailSamples;
                heap[i] *= (1 - proportionOfTail);
            }
        }

        // the "smoothing factor" parameter is the coefficient
        // used on the terms in the low-pass filter
        function renderKarplusStrong(heapOffsets,
                                     sampleRate, hz, velocity,
                                     smoothingFactor, stringTension,
                                     pluckDamping,
                                     characterVariation
                                    ) {
            // coersion to indicate type of arguments
            // ORing with 0 indicates type int
            var seedNoiseStart = heapOffsets.seedStart|0;
            var seedNoiseEnd = heapOffsets.seedEnd|0;
            var targetArrayStart = heapOffsets.targetStart|0;
            var targetArrayEnd = heapOffsets.targetEnd|0;
            sampleRate = sampleRate|0;
            hz = hz|0;

            // Math.fround(x) indicates type float
            var hz_float = Math.fround(hz);
            var period = Math.fround(1/hz_float);
            var periodSamples_float = Math.fround(period*sampleRate);
            // int
            var periodSamples = Math.round(periodSamples_float)|0;
            var frameCount = (targetArrayEnd-targetArrayStart+1)|0;
            var targetIndex = 0;
            var lastOutputSample = 0;
            var curInputSample = 0;

            for (targetIndex = 0;
                    targetIndex < frameCount;
                    targetIndex++) {
                var heapTargetIndex = (targetArrayStart + targetIndex)|0;
                if (targetIndex < periodSamples) {
                    // for the first period, feed in noise
                    var heapNoiseIndex = (seedNoiseStart + targetIndex)|0;
                    var noiseSample = Math.fround(heap[heapNoiseIndex]);
                    // create room for character variation noise
                    noiseSample *= (1 - characterVariation);
                    // add character variation
                    noiseSample += characterVariation * (-1 + 2*Math.random());
                    curInputSample = lowPass(curInputSample, noiseSample, pluckDamping);
                } else {
                    // for subsequent periods, feed in the output from
                    // about one period ago
                    var lastPeriodIndex = heapTargetIndex - periodSamples;
                    var skipFromTension = Math.round(stringTension * periodSamples);
                    var inputIndex = lastPeriodIndex + skipFromTension;
                    curInputSample = Math.fround(heap[inputIndex]);
                }

                // output is low-pass filtered version of input
                var curOutputSample = lowPass(lastOutputSample, curInputSample, smoothingFactor);
                heap[heapTargetIndex] = curOutputSample;
                lastOutputSample = curOutputSample;
            }
        }

        function renderDecayedSine(heapOffsets,
                                   sampleRate, hz, velocity) {
            // coersion to indicate type of arguments
            var seedNoiseStart = heapOffsets.noiseStart|0;
            var seedNoiseEnd = heapOffsets.noiseEnd|0;
            var targetArrayStart = heapOffsets.targetStart|0;
            var targetArrayEnd = heapOffsets.targetEnd|0;
            sampleRate = sampleRate|0;
            hz = hz|0;
            velocity = +velocity;
            // use Math.fround(x) to specify x's type to be 'float'
            var hz_float = Math.fround(hz);
            var unity = Math.fround(1);
            var period = Math.fround(unity/hz_float);
            var periodSamples_float = Math.fround(period*sampleRate);
            // int
            var periodSamples = Math.round(periodSamples_float)|0;
            var frameCount = (targetArrayEnd-targetArrayStart+1)|0;

            var targetIndex = 0;
            while(1) {
                var heapTargetIndex = (targetArrayStart + targetIndex)|0;
                var t = Math.fround(Math.fround(targetIndex)/Math.fround(sampleRate));
                heap[heapTargetIndex] = 
                    velocity *
                    Math.pow(2, -Math.fround(targetIndex) / (Math.fround(frameCount)/8)) *
                    Math.sin(2 * Math.PI * hz * t);
                targetIndex = (targetIndex + 1)|0;
                if (targetIndex == frameCount) {
                    break;
                }
            }
        }

        return { renderKarplusStrong: renderKarplusStrong,
                 renderDecayedSine: renderDecayedSine,
                 fadeTails: fadeTails };
    }
};

// === Guitar ===

// JavaScript's class definitions are just functions
// the function itself serves as the constructor for the class
function Guitar(audioCtx) {
    // 'strings' becomes a 'property'
    // (an instance variable)
    this.strings = [
        new GuitarString(audioCtx, 0, 2, 4),   // E2
        new GuitarString(audioCtx, 1, 2, 9),   // A2
        new GuitarString(audioCtx, 2, 3, 2),   // D3
        new GuitarString(audioCtx, 3, 3, 7),   // G3
        new GuitarString(audioCtx, 4, 3, 11),  // B3
        new GuitarString(audioCtx, 5, 4, 4)    // E4
    ];
}

// each fret represents an increase in pitch by one semitone
// (logarithmically, one-twelth of an octave)
// -1: don't pluck that string
Guitar.C_MAJOR = [-1,  3, 2, 0, 0, 0];
Guitar.G_MAJOR = [ 3,  2, 0, 0, 0, 3];
Guitar.A_MINOR = [ 0,  0, 2, 2, 0, 0];
Guitar.E_MINOR = [ 0,  2, 2, 0, 3, 0];

// To add a class method in JavaScript,
// we add a function property to the class's 'prototype' property
// strum strings set to be strummed by the chord
// (e.g. for C major, don't pluck string 0)
Guitar.prototype.strumChord = function(time, downstroke, velocity, chord) {
    console.log("Strumming with velocity " + velocity +
                ", downstroke: " + downstroke +
                ", at beat " + (time/timeUnit));
    var pluckOrder;
    if (downstroke === true) {
        pluckOrder = [0, 1, 2, 3, 4, 5];
    } else {
        pluckOrder = [5, 4, 3, 2, 1, 0];
    }

    for (var i = 0; i < 6; i++) {
        var stringNumber = pluckOrder[i];
        if (chord[stringNumber] == -1) {
            continue;
        }
        this.strings[stringNumber].pluck(time, velocity, chord[stringNumber]);
        time += Math.random()/128;
    }
};

// === Rhythm code ===

// dummy source used to queue next part of rhythm
function createDummySource(audioCtx) {
    dummySource = audioCtx.createBufferSource();
    var channels = 1;
    // 2 samples seems to the the minimum to get it to work
    var frameCount = 2;
    dummySource.buffer = 
        audioCtx.createBuffer(channels, frameCount, audioCtx.sampleRate);
    dummySource.connect(audioCtx.destination);
    return dummySource;
}

// Create sound samples for the current part of the rhythm sequence,
// and queue creation of the following part of the rhythm.
// The rhythms parts have as fine a granularity as possible to enable
// adjustment of guitar parameters with real-time feedback.
// (The larger the parts, the longer the delay between
//  parameter adjustments and samples created with the new parameters.)
function queueSequence(sequenceN, blockStartTime, chords, chordIndex) {
    console.log("Sequence number " + sequenceN);

    var playState = document.getElementById("playState").value;
    if (playState == "stopped") {
        return;
    }

    var curStrumStartTime;
    var strumGenerationsPerRun = 1;

    while (strumGenerationsPerRun > 0) {
        var chord = chords[chordIndex];
        switch(sequenceN % 13) {
            case 0:
                curStrumStartTime = blockStartTime + timeUnit * 0;
                guitar.strumChord(curStrumStartTime,  true,  1.0, chord);
                break;
            case 1:
                curStrumStartTime = blockStartTime + timeUnit * 4;
                guitar.strumChord(curStrumStartTime,  true,  1.0, chord);
                break;
            case 2:
                curStrumStartTime = blockStartTime + timeUnit * 6;
                guitar.strumChord(curStrumStartTime,  false, 0.8, chord);
                break;
            case 3:
                curStrumStartTime = blockStartTime + timeUnit * 10;
                guitar.strumChord(curStrumStartTime, false, 0.8, chord);
                break;
            case 4:
                curStrumStartTime = blockStartTime + timeUnit * 12;
                guitar.strumChord(curStrumStartTime, true,  1.0, chord);
                break;
            case 5:
                curStrumStartTime = blockStartTime + timeUnit * 14;
                guitar.strumChord(curStrumStartTime, false, 0.8, chord);
                break;
            case 6:
                curStrumStartTime = blockStartTime + timeUnit * 16;
                guitar.strumChord(curStrumStartTime, true,  1.0, chord);
                break;
            case 7:
                curStrumStartTime = blockStartTime + timeUnit * 20;
                guitar.strumChord(curStrumStartTime, true,  1.0, chord);
                break;
            case 8:
                curStrumStartTime = blockStartTime + timeUnit * 22;
                guitar.strumChord(curStrumStartTime, false, 0.8, chord);
                break;
            case 9:
                curStrumStartTime = blockStartTime + timeUnit * 26;
                guitar.strumChord(curStrumStartTime, false, 0.8, chord);
                break;
            case 10:
                curStrumStartTime = blockStartTime + timeUnit * 28;
                guitar.strumChord(curStrumStartTime, true,  1.0, chord);
                break;
            case 11:
                curStrumStartTime = blockStartTime + timeUnit * 30;
                guitar.strumChord(curStrumStartTime, false, 0.8, chord);
                break;
            case 12:

                curStrumStartTime = blockStartTime + timeUnit * 31;
                guitar.strings[2].pluck(curStrumStartTime,   0.7, chord[2]);

                curStrumStartTime = blockStartTime + timeUnit * 31.5;
                guitar.strings[1].pluck(curStrumStartTime, 0.7, chord[1]);

                chordIndex = (chordIndex + 1) % 4;
                blockStartTime += timeUnit*32;

                break;
        }
        sequenceN++;
        strumGenerationsPerRun--;
    }

    // the dummy source has zero length, and is just used to 
    // call queueSequence() again after a period of time
    var queuerSource = createDummySource(audioCtx);
    queuerSource.onended = function() { 
        queueSequence(sequenceN, blockStartTime, chords, chordIndex);
    };
    // we set the next strum to be generated at the same time as the
    // current strum begins playing to allow enough time for the next
    // strum to be generated before it comes time to play it
    queuerSource.start(curStrumStartTime);
}

function getAudioContext() {
    var constructor;
    var error;
    if ('AudioContext' in window) {
        // Firefox, Chrome
        constructor = window.AudioContext;
    } else if ('webkitAudioContext' in window) {
        // Safari
        constructor = window.webkitAudioContext;
    } else {
        // uh-oh; browser doesn't suport Web Audio?
        var guitarErrorText = document.getElementById("guitarErrorText");
        guitarErrorText.innerHTML =
            "<b>Error: unable to get audio context. " +
            "Does your browser support Web Audio?</b>";
        return null;
    }

    var audioContext = new constructor();
    return audioContext;
}

var guitar;
var audioCtx = getAudioContext();
if (audioCtx !== null) {
    // now that we've verified Web Audio support, we can show the panel
    var guitarPanel = document.getElementById("guitarPanel");
    guitarPanel.style.display = 'block';
    guitar = new Guitar(audioCtx);
}

function startPlaying() {
    var blockStartTime = audioCtx.currentTime;
    var startChordIndex = 0;
    var startSequenceN = 0;
    chords = [Guitar.C_MAJOR,
              Guitar.G_MAJOR,
              Guitar.A_MINOR,
              Guitar.E_MINOR];
    queueSequence(startSequenceN, blockStartTime, chords, startChordIndex);
}