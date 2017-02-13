# TinySMF

TinySMF is a tiny JavaScript library for working with MIDI files right in the browser.
It's just 6.6 kB minified, with one similarly tiny dependency on [MetaView](http://www.github.com/need12648430/metaview) at 4.1 kB.

In addition to the following examples, the source code is clean and documented with [Docco](https://jashkenas.github.io/docco/). It can be found [here](https://need12648430.github.io/tinysmf/docs).

## Examples
### Reading a MIDI file
Opening a MIDI file is a simple two step process.
First, you open the `ArrayBuffer` for management with `MetaView`. Note: MIDI files are big endian.

	var input = new MetaView(midiFileInArrayBuffer);
	input.endianness = MetaView.BE;

Then you feed the MetaView instance to the `read` method of a `TinySMF.MIDIFile` instance, like so:

	var midi = new TinySMF.MIDIFile();
	midi.read(input);

### Writing a MIDI file
The process looks very similar to reading. Create a `MetaView` instance, and `write` the `TinySMF.MIDIFile` to it.

	var output = new MetaView();
	output.endianness = MetaView.BE;
	midi.write(output);

At this point, there may be some blank data at the end of `MetaView`'s automatically expanding array buffer. It won't hurt anything, but you can trim it off with:

	output.finalize();

If you'd like to present the user with the MIDI file for downloading, you can generate a data URI link with `MetaView.toDataURI`, like so:

	var downloadLink = output.toDataURI("audio/midi");

### Processing a MIDI file


### Generate a MIDI file
Create a `TinySMF.MIDIFile` instance.

	var midi = new TinySMF.MIDIFile();

Build and specify a `TinySMF.MIDIHeader` for it.

	var header = new TinySMF.MIDIHeader();
	header.format = TinySMF.SingleTrackFormat;

	midi.header = header;

Now let's build a `TinySMF.MIDITrack`.

	var track = new TinySMF.MIDITrack();

	// we can just add it now and build it later
	midi.tracks.push(track);

Let's give our track a name.

	var trackName = new TinySMF.MIDIMessage(
		track,
		0, // time to trigger event, relative to previous event
		TinySMF.META,
		TinySMF.Meta.TrackName,
		[]
	);
	trackName.writeDataFromASCII("Hello world!");
	track.messages.push(trackName);

Set the track's instrument to acoustic piano.

	track.messages.push(
		new TinySMF.MIDIMessage(
			track,
			0,
			TinySMF.CHANNEL,
			TinySMF.Channel.ProgramChange,
			[0] // acoustic piano
		)
	);

And make it play a middle C note for one quarter note.

	// Note on.
	track.messages.push(
		new TinySMF.MIDIMessage(
			track,
			0, // first note is immediate
			TinySMF.CHANNEL,
			TinySMF.Channel.NoteOn,
			[48, 64] // middle c, 50% velocity
		)
	);

	// Note off.
	track.messages.push(
		new TinySMF.MIDIMessage(
			track,
			// ticks = 1 quarter note, so
			// ticks * 4 = 1 whole note later
			midi.header.ticks * 4,
			TinySMF.CHANNEL,
			TinySMF.Channel.NoteOff,
			[48, 64]
		)
	);

MIDI requires us to specify when a track ends:

	// End of tack.
	track.messages.push(
		new TinySMF.MIDIMessage(
			track,
			midi.header.ticks * 4,
			TinySMF.META,
			TinySMF.Meta.EndOfTrack,
			[]
		)
	);

And we're done, let's wrap up and save it:

	var output = new MetaView();
	output.endianness = MetaView.BE;
	midi.write(output);
	output.finalize();
	var downloadLink = output.toDataURI("audio/midi")
