import {
	SlashCommandBuilder,
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	ButtonBuilder,
	ButtonStyle,
	ActionRowBuilder,
	ComponentType,
	ButtonInteraction,
	EmbedBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	ActivityType
} from 'discord.js'
import ytsr from '@distube/ytsr'
import {
	getVoiceConnection,
	joinVoiceChannel,
	createAudioPlayer,
	createAudioResource,
	AudioPlayerStatus,
	StreamType,
	NoSubscriberBehavior,
	AudioPlayer
} from '@discordjs/voice'
import ytdl from '@distube/ytdl-core'

const queue: string[] = []
let currentPlayer: AudioPlayer | null = null
const debugMode = true // Enable debugging output

export const data = new SlashCommandBuilder()
	.setName('play')
	.setDescription('Plays a song based on a URL or search query')
	.addStringOption(
		(option) =>
			option
				.setName('input')
				.setDescription('The URL of the song you want to play or a search term')
				.setRequired(true)
				.setAutocomplete(true) // Enable autocomplete for this option
	)

export async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guild) {
		await interaction.reply('This command can only be used in a server!')
		return
	}

	const input = interaction.options.getString('input')
	const urlPattern = /^https?:\/\/(?:www\.)?.+/

	if (debugMode) console.log(`Executing play command with input: ${input}`)

	if (urlPattern.test(input!)) {
		if (debugMode) console.log('Input is a URL, attempting to play directly.')
		queue.push(input!)
		if (!currentPlayer) {
			await playNext(interaction)
		} else {
			const songInfo = await ytdl.getInfo(input!)

			const embed = new EmbedBuilder()
				.setTitle(`Added to Queue: ${songInfo.videoDetails.title}`)
				.setURL(songInfo.videoDetails.video_url)
				.setThumbnail(songInfo.videoDetails.thumbnails[0].url)
				.addFields(
					{
						name: 'Duration',
						value: `${Math.floor(Number(songInfo.videoDetails.lengthSeconds) / 60)}:${Number(songInfo.videoDetails.lengthSeconds) % 60}`,
						inline: true
					},
					{
						name: 'Channel',
						value: `${songInfo.videoDetails.author.name}`,
						inline: true
					}
				)
				.setColor(0x9b30ff)

			await interaction.reply({ embeds: [embed] })
			updateSkipButton(interaction) // Update the skip button visibility
		}
	} else {
		if (debugMode) console.log('Input is a search term, searching on YouTube.')
		await searchAndSelect(interaction, input!)
	}
}

export async function autocomplete(interaction: AutocompleteInteraction) {
	if (debugMode) console.log('Autocomplete interaction received')

	const focusedValue = interaction.options.getFocused()

	if (!focusedValue.trim()) {
		if (debugMode) console.log('Focused value is empty, skipping autocomplete.')
		return interaction.respond([]) // Return an empty list
	}

	if (debugMode)
		console.log(`Autocomplete triggered with focused value: ${focusedValue}`)

	try {
		const searchResults = await ytsr(focusedValue, { limit: 5 })
		const videos = searchResults.items.filter(
			(item: ytsr.Video) => item.type === 'video'
		)

		const choices = videos.map((video: ytsr.Video) => ({
			name: `${video.name} (${video.duration})`,
			value: video.url
		}))

		await interaction.respond(choices)

		if (debugMode) console.log('Autocomplete response sent successfully.')
	} catch {
		console.error('Autocomplete search failed:')
		await interaction.respond([])
	}
}

async function searchAndSelect(
	interaction: ChatInputCommandInteraction,
	query: string
) {
	const searchResults = await ytsr(query, { limit: 5 })
	const videos = searchResults.items.filter(
		(item: ytsr.Video) => item.type === 'video'
	)

	if (videos.length === 0) {
		await interaction.reply('No search results found!')
		return
	}

	const options = videos.map((video: ytsr.Video) => ({
		label: video.name,
		description: video.duration,
		value: video.url
	}))

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId('song_select')
		.setPlaceholder('Choose a song...')
		.addOptions(options)

	const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		selectMenu
	)

	await interaction.reply({
		content: 'Select a song from the dropdown list:',
		components: [row]
	})

	const filter = (i: StringSelectMenuInteraction) =>
		i.customId === 'song_select' && i.user.id === interaction.user.id

	try {
		const selection = await interaction.channel?.awaitMessageComponent({
			filter,
			componentType: ComponentType.StringSelect,
			time: 15000
		})

		if (selection) {
			const selectedVideoURL = selection.values[0]
			await playSong(interaction, selectedVideoURL)
			await interaction.deleteReply() // Delete the initial message with the dropdown
		}
	} catch {
		if (!interaction.replied && !interaction.deferred) {
			await interaction.editReply({
				content: 'Selection timed out!',
				components: []
			})
		}
	}
}

async function playNext(interaction: ChatInputCommandInteraction) {
	if (queue.length === 0) return

	const URL = queue.shift()!
	await playSong(interaction, URL)
}

async function playSong(interaction: ChatInputCommandInteraction, URL: string) {
	// Check if the interaction has already been deferred
	if (!interaction.deferred && !interaction.replied) {
		await interaction.deferReply()
	}

	let connection = getVoiceConnection(interaction.guildId!)
	if (!connection) {
		const channel = interaction.guild?.members.cache.get(interaction.user.id)
			?.voice.channel
		if (!channel) {
			await interaction.editReply('You need to join a voice channel first!')
			return
		}
		connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator
		})
	}

	if (currentPlayer) {
		currentPlayer.stop() // Stop any currently playing song
	}

	const player = createAudioPlayer({
		behaviors: {
			noSubscriber: NoSubscriberBehavior.Pause
		}
	})

	currentPlayer = player

	try {
		const songInfo = await ytdl.getInfo(URL)
		const stream = ytdl(URL, {
			filter: 'audioonly',
			quality: 'highestaudio',
			highWaterMark: 1 << 25
		})

		const resource = createAudioResource(stream, {
			inputType: StreamType.Arbitrary
		})

		player.play(resource)
		connection.subscribe(player)

		// Update bot presence
		interaction.client.user?.setActivity(`${songInfo.videoDetails.title}`, {
			type: ActivityType.Listening
		})

		const nowPlayingEmbed = new EmbedBuilder()
			.setTitle(`Now Playing: ${songInfo.videoDetails.title}`)
			.setURL(songInfo.videoDetails.video_url)
			.setThumbnail(songInfo.videoDetails.thumbnails[0].url)
			.addFields(
				{
					name: 'Duration',
					value: `${Math.floor(Number(songInfo.videoDetails.lengthSeconds) / 60)}:${Number(songInfo.videoDetails.lengthSeconds) % 60}`,
					inline: true
				},
				{
					name: 'Channel',
					value: `${songInfo.videoDetails.author.name}`,
					inline: true
				}
			)
			.setColor(0x9b30ff)

		const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('stop')
				.setLabel('⏹️ Stop')
				.setStyle(ButtonStyle.Danger),
			new ButtonBuilder()
				.setCustomId('pause')
				.setLabel('⏸️ Pause')
				.setStyle(ButtonStyle.Secondary),
			...(queue.length > 0
				? [
						new ButtonBuilder()
							.setCustomId('skip')
							.setLabel('⏭️ Skip')
							.setStyle(ButtonStyle.Primary)
					]
				: [])
		)

		const playingMessage = await interaction.followUp({
			embeds: [nowPlayingEmbed],
			components: [controls]
		})

		// Implement the component collector for button interactions
		const buttonFilter = (i: ButtonInteraction) =>
			i.user.id === interaction.user.id

		const collector = playingMessage.createMessageComponentCollector({
			filter: buttonFilter,
			componentType: ComponentType.Button,
			time: Number(songInfo.videoDetails.lengthSeconds) * 1000 // Duration of the song in milliseconds
		})

		collector.on('collect', async (i: ButtonInteraction) => {
			await i.deferUpdate() // Immediately acknowledge the interaction

			if (i.customId === 'stop') {
				player.stop()
				try {
					await i.editReply({ content: 'Playback stopped!', components: [] })
				} catch {
					console.error(
						'Message could not be edited. It might have been deleted.'
					)
				}
				currentPlayer = null
				queue.length = 0 // Clear the queue when stopped
				interaction.client.user?.setActivity(null) // Clear bot activity
			} else if (i.customId === 'pause') {
				if (player.state.status === AudioPlayerStatus.Playing) {
					player.pause()
					try {
						await i.editReply({
							components: [
								new ActionRowBuilder<ButtonBuilder>().addComponents(
									new ButtonBuilder()
										.setCustomId('stop')
										.setLabel('⏹️ Stop')
										.setStyle(ButtonStyle.Danger),
									new ButtonBuilder()
										.setCustomId('resume')
										.setLabel('▶️ Resume')
										.setStyle(ButtonStyle.Success),
									...(queue.length > 0
										? [
												new ButtonBuilder()
													.setCustomId('skip')
													.setLabel('⏭️ Skip')
													.setStyle(ButtonStyle.Primary)
											]
										: [])
								)
							]
						})
					} catch {
						console.error(
							'Message could not be edited. It might have been deleted.'
						)
					}
				}
			} else if (i.customId === 'resume') {
				if (player.state.status === AudioPlayerStatus.Paused) {
					player.unpause()
					try {
						await i.editReply({
							components: [
								new ActionRowBuilder<ButtonBuilder>().addComponents(
									new ButtonBuilder()
										.setCustomId('stop')
										.setLabel('⏹️ Stop')
										.setStyle(ButtonStyle.Danger),
									new ButtonBuilder()
										.setCustomId('pause')
										.setLabel('⏸️ Pause')
										.setStyle(ButtonStyle.Secondary),
									...(queue.length > 0
										? [
												new ButtonBuilder()
													.setCustomId('skip')
													.setLabel('⏭️ Skip')
													.setStyle(ButtonStyle.Primary)
											]
										: [])
								)
							]
						})
					} catch {
						console.error(
							'Message could not be edited. It might have been deleted.'
						)
					}
				}
			} else if (i.customId === 'skip') {
				player.stop()
				if (queue.length > 0) {
					await playNext(interaction)
				} else {
					await i.editReply({
						content: 'No more songs in the queue.',
						components: []
					})
					currentPlayer = null
				}
			}
		})

		player.on(AudioPlayerStatus.Idle, async () => {
			if (queue.length > 0) {
				await playNext(interaction)
			} else {
				await playingMessage.edit({
					content: 'Playback finished.',
					components: []
				})
				interaction.client.user?.setActivity(null) // Clear bot activity
				currentPlayer = null
			}
		})

		collector.on('end', async () => {
			if (playingMessage.editable) {
				await playingMessage.edit({ components: [] })
			}
		})
	} catch (error) {
		console.error('Error playing song:', error)
		await interaction.editReply('There was an error trying to play the song!')
	}
}

async function updateSkipButton(interaction: ChatInputCommandInteraction) {
	if (debugMode)
		console.log(
			'Adding skip button and setting behavior based on queue status.'
		)

	try {
		const message = await interaction.fetchReply()
		const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('skip')
				.setLabel('⏭️ Skip')
				.setStyle(ButtonStyle.Primary)
		)

		await message.edit({ components: [actionRow] })

		const buttonFilter = (i: ButtonInteraction) =>
			i.customId === 'skip' && i.user.id === interaction.user.id

		const collector = message.createMessageComponentCollector({
			filter: buttonFilter,
			componentType: ComponentType.Button,
			time: 60000 // You can adjust the collector timeout if needed
		})

		collector.on('collect', async (i: ButtonInteraction) => {
			await i.deferUpdate() // Acknowledge the interaction immediately

			if (queue.length > 0) {
				// Skip to the next song if the queue is not empty
				currentPlayer?.stop()
				await playNext(interaction)
			} else {
				// If the queue is empty, stop the current playback
				currentPlayer?.stop()
				currentPlayer = null
				interaction.client.user?.setActivity(null) // Clear bot activity

				try {
					await i.editReply({
						content: 'No more songs in the queue. Playback stopped!',
						components: []
					})
				} catch {
					console.error(
						'Message could not be edited. It might have been deleted.'
					)
				}
			}
		})
	} catch (error) {
		console.error('Failed to add or update the skip button:', error)
	}
}
