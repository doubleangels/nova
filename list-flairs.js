const snoowrap = require('snoowrap');
const config = require('./config');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));

async function main() {
  const reddit = new snoowrap({
    userAgent: 'Discord Bot Flair Lister',
    clientId: config.redditClientId,
    clientSecret: config.redditClientSecret,
    username: config.redditUsername,
    password: config.redditPassword
  });

  try {
    logger.info('Fetching link flairs for r/DiscordAdvertising...');
    const subreddit = await reddit.getSubreddit('discordapp');
    const linkFlairs = await subreddit.getLinkFlairTemplates();
    logger.info('Raw linkFlairs response:', { linkFlairs });
    if (Array.isArray(linkFlairs) && linkFlairs.length > 0) {
      logger.info(`Found ${linkFlairs.length} link flairs:`);
      linkFlairs.forEach(flair => {
        console.log(JSON.stringify(flair, null, 2));
      });
    } else {
      logger.info('No link flairs found. Trying user flairs...');
      const userFlairs = await subreddit.getUserFlairTemplates();
      logger.info('Raw userFlairs response:', { userFlairs });
      if (Array.isArray(userFlairs) && userFlairs.length > 0) {
        logger.info(`Found ${userFlairs.length} user flairs:`);
        userFlairs.forEach(flair => {
          console.log(JSON.stringify(flair, null, 2));
        });
      } else {
        logger.info('No user flairs found either.');
      }
    }
  } catch (error) {
    logger.error('Failed to fetch flairs:', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

main();

