#! /usr/bin/env node
import { Command } from "commander";
import open from "open";
import boxen from "boxen";
import chalk from "chalk";
import http from "http";
import inquirer from "inquirer";
import { createHash } from "crypto";
import Randomstring from "randomstring";
import Url from "url-parse";
import axios from "axios";
import fs from 'fs';
import Conf from 'conf';
import moment from 'moment';

const program = new Command();
const config = new Conf();

const CONSTANTS = {
  SPOTIFY_SCOPES:
    "user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read app-remote-control user-read-recently-played playlist-read-collaborative playlist-read-private",
};

program
  .name("spotify-cli")
  .description(
    "An unofficial command line interface for interaction with Spotify"
  )
  .version(process.version);

program
  .command("login")
  .description("Opens your browser to login to your Spotify account")
  .action(login);

program 
  .command("reset")
  .description("Resets all data that the application has stored.")
  .action(async () => {
    const { confirm } = await inquirer.prompt([
      {
        name: 'confirm',
        type: 'confirm',
        message: 'Are you sure you want to reset all data?',
        default: false
      }
    ]);

    if (confirm) {
      config.clear();
      console.log(chalk.green('All config values has been reset.'));
      return;
    } else {
      console.log(chalk.red('Cancelled.'))
    }
  });

program
  .command('song')
  .alias('current')
  .description('Shows the current song playing on Spotify.')
  .action(song);

program
  .command('pause')
  .alias('stop')
  .description('Pauses the current song.')
  .action(pause);

program
  .command('play')
  .alias('resume')
  .argument('[song...]', 'The song to play', null)
  .description('Resumes the current song, or plays the song specified.')
  .action(play);

program
  .command('skip')
  .alias('next')
  .description('Skips the current song.')
  .action(skip);

program
  .command('back')
  .alias('previous')
  .description('Skips to the previous song.')
  .action(previous);

program
  .command('playlist')
  .alias('pl')
  .argument('[playlist...]', 'The playlist to play', null)
  .description('Plays the specified playlist.')
  .action(playlist);

program
  .command('volume')
  .alias('vol')
  .argument('<volume...>', 'The volume to set')
  .description('Sets the volume to the specified value.')
  .action(volume);

program
  .command('lyrics')
  .alias('ly')
  .description('Searches for the lyrics of the currently playing song.')
  .action(lyrics);

async function updateCode() {
  if (!config.has('refresh_token')) {
    console.log(chalk.red('You need to login first.'));
    login();
  }

  if (Date.now() < config.get('expires_at')) {
    return;
  }

  const { data } = await axios({
    url: "https://accounts.spotify.com/api/token",
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.get('client_id')}:${config.get('client_secret')}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: {
      grant_type: "refresh_token",
      refresh_token: config.get('refresh_token'),
    },
  });

  config.set('access_token', data.access_token);
  config.set('expires_at', Date.now() + data.expires_in * 1000);
}

async function login() {
  if (!config.has("client_id")) {
    console.log(
      chalk.blueBright(
        "Please create an application at https://developer.spotify.com/dashboard and provide the details below."
      )
    );
    console.log(
      chalk.yellowBright('You must also add http://localhost:6894 as a redirect URI to the application.')
    )

    const { clientId, clientSecret } = await inquirer.prompt([
      {
        type: "input",
        message: "Client ID:",
        name: "clientId",
      },
      {
        type: "input",
        message: "Client Secret:",
        name: "clientSecret",
      },
    ]);

    config.set("client_id", clientId);
    config.set("client_secret", clientSecret);
    console.log();
  }

  if (config.has("access_token")) {
    console.log(chalk.red("You are already logged in!"));
    const { logout } = await inquirer.prompt([
      {
        type: "confirm",
        message: "Would you like to log out and log in again?",
        default: false,
        name: "logout",
      },
    ]);

    if (logout == false) {
      return;
    }
  }

  const state = createHash("sha256")
    .update(Randomstring.generate(16))
    .digest("hex");

  const server = new http.Server(async (request, response) => {
    const { query } = new Url(request.url, true);

    if (query.error) {
      console.log(chalk.red("An error occured:\n" + query.error));
      return;
    }

    if (query.state !== state) {
      response.writeHead(400);
      response.write('Missing state parameter, or it is invalid.');
      response.end();
      return;
    }

    response.writeHead(200, { "Content-Type": "text/plain" });
    response.write(
      "Login successful. Please refer to the command line.\nYou may now close this page."
    );
    response.end();
    server.close();

    const { data } = await axios({
      url: "https://accounts.spotify.com/api/token?grant_type=authorization_code&code=" + query.code + "&redirect_uri=http://localhost:6894",
      headers: {
        Authorization: 'Basic ' + Buffer.from(config.get('client_id') + ':' + config.get('client_secret')).toString('base64'),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "post",
    });
    
    config.set('access_token', data.access_token);
    config.set('refresh_token', data.refresh_token);
    config.set('token_type', data.token_type);
    config.set('expires_at', Date.now() + data.expires_in * 1000);
    console.log(chalk.green("Login successful!"));

    const user = await axios({
      url: 'https://api.spotify.com/v1/me',
      headers: {
        Authorization: config.get('token_type') + ' ' + config.get('access_token'),
        'Content-Type': 'application/json'
      }
    });

    console.log(boxen(`
      Username: ${user.data.display_name}
      ID: ${user.data.id}
    `, { padding: { top: 0, bottom: 0, left: 0, right: 6 }, borderStyle: 'round' }))
    server.close();
    process.exit(0);
  });
  server.listen(6894);

  console.log("Opening browser...");
  open(
    `https://accounts.spotify.com/authorize?client_id=${config.get(
      "client_id"
    )}&response_type=code&redirect_uri=http://localhost:6894&scope=${
      CONSTANTS.SPOTIFY_SCOPES
    }&state=${state}&show_dialog=true`
  );
}

async function song() {
  await updateCode();

  const { data } = await axios({
    url: 'https://api.spotify.com/v1/me/player/currently-playing',
    headers: {
      Authorization: config.get('token_type') + ' ' + config.get('access_token'),
      'Content-Type': 'application/json'
    }
  });

  if (data.is_playing) {
    console.log(chalk.green('Currently playing:'));
    console.log(boxen(`
      Artist: ${data.item.artists.map(artist => artist.name).join(', ')}
      Title: ${data.item.name}
      Album: ${data.item.album.name}
      Duration: ${moment.duration(data.item.duration_ms).minutes() + ":" + moment.duration(data.item.duration_ms).seconds()}
      Current Seek: ${moment.duration(data.progress_ms).minutes() + ":" + moment.duration(data.progress_ms).seconds()}
      Time Left: ${moment.duration(data.item.duration_ms - data.progress_ms).minutes() + ":" + moment.duration(data.item.duration_ms - data.progress_ms).seconds()}
      Link: ${data.item.external_urls.spotify}
    `, { padding: { top: 0, bottom: 0, left: 0, right: 6 }, borderStyle: 'round' }))
  } else {
    console.log(chalk.red("Not playing anything!"));
  }
}

async function pause() {
  await updateCode();

  const { data } = await axios({
    url: 'https://api.spotify.com/v1/me/player/pause',
    method: 'put',
    headers: {
      Authorization: config.get('token_type') + ' ' + config.get('access_token'),
      'Content-Type': 'application/json'
    }
  });

  console.log(chalk.green("Paused!"));
}

async function play(song: string) {
  await updateCode();

  if (song !== null) {
    // Search the spotify api for the song
    const { data } = await axios({
      url: 'https://api.spotify.com/v1/search?q=' + song + '&type=track',
      headers: {
        Authorization: config.get('token_type') + ' ' + config.get('access_token'),
        'Content-Type': 'application/json'
      }
    });

    if (data.tracks.items.length === 0) {
      console.log(chalk.red("Couldn't find that song!"));
      return;
    }

    let toPlay = 0;

    // if multiple songs are found, ask the user to choose one
    if (data.tracks.items.length > 1) {
      const { listData } = await inquirer.prompt([
        {
          type: "list",
          message: "Which song would you like to play?",
          name: "listData",
          choices: data.tracks.items.map(item => item.name + ' - ' + item.artists.map(artist => artist.name).join(', ')),
        },
      ]);

      toPlay = data.tracks.items.findIndex(item => item.name + ' - ' + item.artists.map(artist => artist.name).join(', ') === listData);
    }

    // Play the song
    await axios({
      url: 'https://api.spotify.com/v1/me/player/play',
      method: 'put',
      headers: {
        Authorization: config.get('token_type') + ' ' + config.get('access_token'),
        'Content-Type': 'application/json'
      },
      data: {
        uris: [data.tracks.items[toPlay].uri]
      }
    });

    // Print the song information
    console.log(chalk.green("Now playing:"));
    console.log(boxen(`
      Artist: ${data.tracks.items[toPlay].artists.map(artist => artist.name).join(', ')}
      Title: ${data.tracks.items[toPlay].name}
      Album: ${data.tracks.items[toPlay].album.name}
      Duration: ${moment.duration(data.tracks.items[toPlay].duration_ms).minutes() + ":" + moment.duration(data.tracks.items[toPlay].duration_ms).seconds()}
      Link: ${data.tracks.items[toPlay].external_urls.spotify}
    `, { padding: { top: 0, bottom: 0, left: 0, right: 6 }, borderStyle: 'round' }));
  } else {
    const { data } = await axios({
      url: 'https://api.spotify.com/v1/me/player/play',
      method: 'put',
      headers: {
        Authorization: config.get('token_type') + ' ' + config.get('access_token'),
        'Content-Type': 'application/json'
      }
    });
  
    console.log(chalk.green("Resumed!"));
  }
}

async function skip() {
  await updateCode();

  await axios({
    url: 'https://api.spotify.com/v1/me/player/next',
    method: 'post',
    headers: {
      Authorization: config.get('token_type') + ' ' + config.get('access_token'),
      'Content-Type': 'application/json'
    }
  });

  console.log(chalk.green("Skipped!"));
}

async function previous() {
  await updateCode();

  await axios({
    url: 'https://api.spotify.com/v1/me/player/previous',
    method: 'post',
    headers: {
      Authorization: config.get('token_type') + ' ' + config.get('access_token'),
      'Content-Type': 'application/json'
          }
  });

  console.log(chalk.green("Skipped to previous track!"));
}

async function volume(volume?: string) {
  await updateCode();

  if (volume !== null) {
    await axios({
      url: 'https://api.spotify.com/v1/me/player/volume?volume_percent=' + volume,
      method: 'put',
      headers: {
        Authorization: config.get('token_type') + ' ' + config.get('access_token'),
        'Content-Type': 'application/json'
      }
    });

    console.log(chalk.green("Volume set to " + volume + "%!"));
  }
}

async function playlist(playlist: string) {
  await updateCode();

  if (playlist !== null) {
    // Search the spotify api for the playlist
    const { data } = await axios({
      url: 'https://api.spotify.com/v1/search?q=' + playlist + '&type=playlist',
      headers: {
        Authorization: config.get('token_type') + ' ' + config.get('access_token'),
        'Content-Type': 'application/json'
      }
    });

    if (data.playlists.items.length === 0) {
      console.log(chalk.red("Couldn't find that playlist!"));
      return;
    }

    let toPlay = 0;

    // if multiple playlists are found, ask the user to choose one
    if (data.playlists.items.length > 1) {
      const { listData } = await inquirer.prompt([
        {
          type: "list",
          message: "Which playlist would you like to play?",
          name: "listData",
          choices: data.playlists.items.map(item => item.name),
        },
      ]);

      toPlay = data.playlists.items.findIndex(item => item.name === listData);
    }

    // Play the playlist
    await axios({
      url: 'https://api.spotify.com/v1/me/player/play',
      method: 'put',
      headers: {
        Authorization: config.get('token_type') + ' ' + config.get('access_token'),
        'Content-Type': 'application/json'
      },
      data: {
        context_uri: data.playlists.items[toPlay].uri
      }
    });

    // Print the song information
    console.log(chalk.green("Now playing:"));
    console.log(boxen(`
      Name: ${data.playlists.items[toPlay].name}
      Link: ${data.playlists.items[toPlay].external_urls.spotify}
    `, { padding: { top: 0, bottom: 0, left: 0, right: 6 }, borderStyle: 'round' }));
  }
}

async function lyrics() {
  await updateCode();

  // Get the current song
  const { data } = await axios({
    url: 'https://api.spotify.com/v1/me/player/currently-playing',
    headers: {
      Authorization: config.get('token_type') + ' ' + config.get('access_token'),
      'Content-Type': 'application/json'
    }
  });

  if (data.item === null) {
    console.log(chalk.red("You're not listening to anything!"));
    return;
  }

  try {
    // Get the lyrics
    const { data: lyrics } = await axios({
      url: 'https://api.lyrics.ovh/v1/' + data.item.artists[0].name + '/' + data.item.name,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Print the lyrics
    console.log(chalk.green("Lyrics:"));
    console.log(boxen(lyrics.lyrics, { padding: { top: 0, bottom: 0, left: 0, right: 6 }, borderStyle: 'round' }));
  } catch (error) {
    console.log(chalk.red("Couldn't find lyrics!"));
  }
}

program.parse(); 
