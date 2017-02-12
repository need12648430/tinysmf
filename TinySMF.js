// # TinySMF
// ----------------------------------------------------------------------------
// TinySMF is a library for reading and writing simple MIDI files. Its only
// dependency is on [MetaView](#), a similarly tiny convenience library for
// reading and writing to JavaScript DataViews.

/*
Copyright (c) 2017 Jahn Johansen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

var TinySMF = (function () {
	// We define some useful English names for MIDI values here.
	var TinySMF = {};

	TinySMF.HeaderChunk = "MThd";
	TinySMF.TrackChunk = "MTrk";

	TinySMF.SingleTrackFormat = 0;
	TinySMF.MultiTrackFormat = 1;
	TinySMF.MultiSongFormat = 2;

	TinySMF.TicksPerQuarterNote = 0;
	TinySMF.SMTPEFramesPerSecond = 1;

	TinySMF.CHANNEL = 0x80;
	TinySMF.META = 0xFF;
	TinySMF.SYSEX = 0xF0;
	TinySMF.SYSEX_CONT = 0xF7;

	TinySMF.Channel = {
		NoteOff: 0x8,
		NoteOn: 0x9,
		PolyphonicPressure: 0xA,
		Controller: 0xB,
		ProgramChange: 0xC,
		ChannelPressure: 0xD,
		PitchBend: 0xE
	};

	TinySMF.Meta = {
		Text: 0x01,
		Copyright: 0x02,
		TrackName: 0x03,
		InstrumentName: 0x04,
		Lyric: 0x05,
		EndOfTrack: 0x2F,
		Tempo: 0x51,
		TimeSignature: 0x58,
		KeySignature: 0x59
	}

	// ## toASCII (bytes)
	// --------------------------------------------------------------------------
	// Used internally, private. Converts array of `bytes` into an ASCII string.
	function toASCII (bytes) {
		var ascii = "", i = 0;
		while (i < bytes.length)
			ascii += String.fromCharCode(bytes[i ++]);
		return ascii;
	}

	// ## fromASCII (string)
	// --------------------------------------------------------------------------
	// Used internally, private. Converts `string` into an array of bytes.
	function fromASCII (string) {
		var bytes = [], i = 0;
		while (bytes.length < string.length)
			bytes.push(string.charCodeAt(i ++));
		return bytes;
	}

	// ## VLQ
	// --------------------------------------------------------------------------
	// Used internally, private. Reads and writes variable-length quantities.
	var VLQ = {
		buffer: new Array(8),

		// ### VLQ.read (input)
		// ------------------------------------------------------------------------
		// Reads a variable-length quantity from MetaView instance `input`.
		read: function (input) {
			var c = input.readUint8(1), q = c & 0x7F;

			while (c & 0x80) {
				c = input.readUint8(1);
				q = (q << 7) | (c & 0x7F);
			}

			return q;
		},


		// ### VLQ.write (output, value)
		// ------------------------------------------------------------------------
		// Writes `value` as a variable-length quantity to MetaView instance `output`.
		write: function (output, value) {
			var c = value & 0x7F, i = 0;
			value >>= 7;
			this.buffer[i ++] = c;

			while (value > 0) {
				c = 0x80 | (value & 0x7F);
				value >>= 7;
				this.buffer[i ++] = c;
			}

			while (i > 0)
				output.writeUint8(this.buffer[--i]);
		}
	}

	// ## MIDIHeader ()
	// --------------------------------------------------------------------------
	// MIDI header chunk abstraction class. Stores all the MIDI header chunk information
	// for later manipulation, reading, and writing.
	function MIDIHeader () {
		this.identifier = TinySMF.HeaderChunk;
		this.length = 6;
		this.format = 1;
		this.tracks = 1;
		this.timeMode = TinySMF.TicksPerQuarterNote;
		this.ticks = 0x60;
	}

	MIDIHeader.prototype = {
		// ### MIDIHeader.read (input)
		// ------------------------------------------------------------------------
		// Reads data from MetaView instance `input` into this MIDIHeader instance.
		read: function (input) {
			this.identifier = toASCII(input.readUint8(4));
			this.length = input.readUint32(1);
			this.format = input.readUint16(1);
			this.tracks = input.readUint16(1);

			var division = input.readUint16(1);

			if (!(division & 0x8000)) {
				this.timeMode = TinySMF.TicksPerQuarterNote;
				this.ticks = division & 0x7FFF;
			} else {
				this.timeMode = TinySMF.SMTPEFramesPerSecond;
				this.ticks = division & 0xFF;
				this.smtpe = 0xFF - ((division & 0xFF00) >> 8) + 1;
			}

			// We're required to honor >6 byte headers
			// so we skip the excess. ;)
			input.cursor += this.length - 6;
		},

		// ### MIDIHeader.write (output)
		// ------------------------------------------------------------------------
		// Writes data from this MIDIHeader instance to MetaView instance `output`.
		write: function (output) {
			output.writeUint8(fromASCII(this.identifier));
			output.writeUint32(this.length);
			output.writeUint16(this.format);
			output.writeUint16(this.tracks);

			if (this.timeMode == TinySMF.TicksPerQuarterNote) {
				output.writeUint16(this.ticks);
			} else {
				output.writeUint16((this.smtpe << 8) | (this.ticks & 0xFF));
			}
		}
	}

	// ## MIDITrack ()
	// --------------------------------------------------------------------------
	// MIDI track chunk abstraction class. Stores all the MIDI track chunk information
	// for later manipulation, reading, and writing.
	function MIDITrack () {
		this.identifier = TinySMF.TrackChunk;
		this.length = 0;
		this.messages = [];
	}

	MIDITrack.prototype = {
		// ### MIDITrack.read (input)
		// ------------------------------------------------------------------------
		// Reads data from MetaView instance `input` into this MIDITrack instance.
		read: function (input) {
			this.identifier = toASCII(input.readUint8(4));
			this.length = input.readUint32();

			var start = input.cursor, message;

			this.runningStatus = 0;

			while (input.cursor - start < this.length) {
				message = new MIDIMessage(this);
				message.read(input);
				this.messages.push(message);
			}
		},

		// ### MIDITrack.write (output)
		// ------------------------------------------------------------------------
		// Writes data from this MIDITrack instance to MetaView instance `output`.
		write: function (output) {
			output.writeUint8(fromASCII(this.identifier));

			var sizepos = output.cursor, size;
			output.writeUint32(0);
			size = output.cursor;

			for (var i = 0; i < this.messages.length; i ++)
				this.messages[i].write(output);

			size = output.cursor - size;
			output.cursor = sizepos;
			output.writeUint32(size);
			output.cursor += size;
		}
	}

	// ## MIDIMessage (track, time, type, subtype, data)
	// --------------------------------------------------------------------------
	// MIDI message abstraction class.
	//
	// `MIDIMessage.track` is the track that contains this event.
	//
	// `MIDIMessage.time` is the time (relative to the previous event) this message
	// is to be interpreted.
	//
	// `MIDIMessage.type` is the message type, one of `TinySMF.META`, `TinySMF.SYSEX`,
	// `TinySMF.SYSEX_CONT`, or `TinySMF.CHANNEL`.
	//
	// `MIDIMessage.subtype` describes the precise type of event, e.g.
	// `TinySMF.Meta.TrackName` or `TinySMF.Channel.NoteOn`
	//
	// `MIDIMessage.data` is an array, its elements vary depending on the needs of
	// the message subtype. For example, `TinySMF.Channel.NoteOn` data contains 2
	// bytes representing the pitch of the note, and its velocity.
	//
	// I'd recommend reading up on the different
	// [types of messages](http://www.somascape.org/midi/tech/mfile.html) and their
	// corresponding data bytes.
	function MIDIMessage (track, time, type, subtype, data) {
		// Stores an internal reference to the parent track.
		this.track = track;
		this.time = time || 0;
		this.type = type || 0xF0;
		this.subtype = subtype || 0;
		this.data = data || [0xF7];
	}

	MIDIMessage.prototype = {
		// ### MIDIMessage.read (input)
		// ------------------------------------------------------------------------
		// Reads data from MetaView instance `input` into this MIDIMessage.
		read: function (input) {
			this.time = VLQ.read(input);
			this.status = input.readUint8();

			if (this.status >> 4 == 0xF) {
				if (this.status == TinySMF.META) {
					this.type = TinySMF.META;
					this.subtype = input.readUint8();
					this.length = VLQ.read(input);
					this.data = this.length ? input.readUint8(this.length) : [];
				} else if (this.status == TinySMF.SYSEX) {
					this.type = TinySMF.SYSEX;
					this.length = VLQ.read(input);
					this.data = this.length ? input.readUint8(this.length) : [];
				} else if (this.status == TinySMF.SYSEX_CONT) {
					this.type = TinySMF.SYSEX_CONT;
					this.length = VLQ.read(input);
					this.data = this.length ? input.readUint8(this.length) : [];
				}
			} else {
				// Running status. Some MIDI files still use it, so we take it into
				// consideration.
				if (!(this.status & 0x80)) {
					this.status = this.track.runningStatus;
					input.cursor --;
				} else {
					this.track.runningStatus = this.status;
				}

				this.type = TinySMF.CHANNEL;
				this.subtype = (this.status & 0xF0) >> 4;
				this.channel = this.status & 0x0F;
				this.data = [];

				if (this.subtype >= 0x8 && this.subtype <= 0xB) {
					this.data[0] = input.readUint8();
					this.data[1] = input.readUint8();
				} else if (this.subtype == 0xC || this.subtype == 0xD) {
					this.data[0] = input.readUint8();
				} else if (this.subtype == 0xE) {
					this.data[0] = input.readUint8() | (input.readUint8() << 7);
				}
			}
		},

		// ### MIDIMessage.write (output)
		// ------------------------------------------------------------------------
		// Writes this MIDIMessage to MetaView instance `output`.
		write: function (output) {
			VLQ.write(output, this.time);

			if (this.type == TinySMF.META) {
				output.writeUint8(0xFF);
				output.writeUint8(this.subtype);
				VLQ.write(output, this.data.length);
				if (this.data.length)
					output.writeUint8(this.data);
			} else if (this.type == TinySMF.SYSEX ||
								 this.type == TinySMF.SYSEX_CONT) {
				output.writeUint8(this.status);
				VLQ.write(output, this.data.length);
				if (this.data.length)
					output.writeUint8(this.data);
			} else if (this.type == TinySMF.CHANNEL){
				output.writeUint8((this.subtype << 4) | this.channel);
				if (this.subtype >= 0x8 && this.subtype <= 0xB) {
					output.writeUint8(this.data[0]);
					output.writeUint8(this.data[1]);
				} else if (this.subtype >= 0xC && this.subtype <= 0xD) {
					output.writeUint8(this.data[0]);
				} else if (this.subtype == 0xE) {
					output.writeUint8(this.data[0] & 0x7F);
					output.writeUint8((this.data[0] >> 7) & 0x7F);
				}
			}
		},

		// ### MIDIMessage.readDataAsASCII ()
		// ------------------------------------------------------------------------
		// Returns `data` represented as an ASCII string.
		readDataAsASCII: function () {
			return this.data ? toASCII(this.data) : null;
		},

		// ### MIDIMessage.writeDataFromASCII (string)
		// ------------------------------------------------------------------------
		// Sets `data` to `string` as ASCII bytes.
		writeDataFromASCII: function (string) {
			this.data = fromASCII(string);
		}
	}

	// ## MIDIFile ()
	// --------------------------------------------------------------------------
	// Ties together all of the above abstractions, contains a header and a collection
	// of tracks.
	function MIDIFile () {
		this.header = null;
		this.tracks = [];
	}

	MIDIFile.prototype = {
		// ### MIDIFile.read (input)
		// ------------------------------------------------------------------------
		// Reads an entire file at once from MetaView instance `input`.
		read: function (input) {
			var chunkID, chunk;

			this.header = new MIDIHeader();
			this.header.read(input);

			while (this.tracks.length != this.header.tracks) {
				chunkID = toASCII(input.peekUint8(4));

				if (chunkID == TinySMF.TrackChunk) {
					chunk = new TinySMF.MIDITrack();
					chunk.read(input);
					this.tracks.push(chunk);
				} else {
					input.readUint8(4);
					input.cursor += input.readUint32();
				}
			}
		},

		// ### MIDIFile.write (output)
		// ------------------------------------------------------------------------
		// Writes the `MIDIHeader` and all `MIDITrack`s at once to MetaView instance
		// `output`.
		write: function (output) {
			this.writeHeader(output);

			for (var i = 0; i < this.tracks.length; i ++)
				this.writeTrack(output, i);
		},

		// ### MIDITrack.writeHeader (output)
		// ------------------------------------------------------------------------
		// Only writes the contained `MIDIHeader` instance to MetaView instance
		// `output`. Useful for breaking the file writing process up to prevent hanging.
		writeHeader: function (output) {
			this.header.tracks = this.tracks.length;
			this.header.write(output);
		},

		// ### MIDITrack.writeTrack (output, index)
		// ------------------------------------------------------------------------
		// Only writes the `MIDITrack` instance at `index` to MetaView instance
		// `output`. Useful for breaking the file writing process up to prevent hanging.
		writeTrack: function (output, index) {
			this.tracks[index].write(output);
		}
	}

	TinySMF.MIDIHeader = MIDIHeader;
	TinySMF.MIDITrack = MIDITrack;
	TinySMF.MIDIMessage = MIDIMessage;
	TinySMF.MIDIFile = MIDIFile;

	return TinySMF;
})();
