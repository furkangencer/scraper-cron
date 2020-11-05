import AWS from 'aws-sdk';
import puppeteer from "puppeteer-core";
import chromium from 'chrome-aws-lambda';

const ses = new AWS.SES({ region: 'eu-central-1' });
const s3 = new AWS.S3({ region: 'eu-central-1' });

const getChrome = async ()  => {
  let browser = null

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: {
        width: 1680,
        height: 1050,
      },
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    })
  } catch (err) {
    console.error(err)
  }

  return browser
}

const retrieveItemsFromS3Bucket = async (key) => {
  let items;
  const params = {
    Bucket: process.env.ITEMS_TO_SCRAPE_BUCKET_NAME,
    Key: key
  };
  const S3Object = await s3.getObject(params).promise().catch(e => []);
  if(S3Object && S3Object.Body) {
    // console.log("EXISTS IN BUCKET!");
    items = JSON.parse(Buffer.from(S3Object.Body).toString("utf8"));
  } else {
    // console.log("NEW BUCKET CREATED!");
    items = await require('../../items.json');

    await uploadFileToS3('items-to-scrape.json', JSON.stringify(items));
  }
  return items;
}

const uploadFileToS3 = async (key, body) => {
  return s3.upload({
    Bucket: process.env.ITEMS_TO_SCRAPE_BUCKET_NAME,
    Key: key,
    Body: body,
  }).promise();
  // return result.Location;
};

const checkItem = async (page, item) => {
  // console.log(`Checking ${item.name}`);
  await page.goto(item.url);

  const canAdd = await page.$(item.pattern);
  //const notInStock = (await page.content()).match(/in stock on/gi);

  return canAdd;
  //return canAdd && !notInStock;
}

const sendMail = async ({ subject, body, recipient }) => {
  const params = {
    Source: process.env.SES_SENDER, // Mmust be the same email which is verified via Amazon SES
    Destination: {
      ToAddresses: [recipient]
    },
    Message: {
      Body: {
        Text: {
          Data: body
        }
      },
      Subject: {
        Data: subject,
      }
    }
  };

  return ses.sendEmail(params).promise();
}

export const handler = async (event) => {
  try {
    const items = await retrieveItemsFromS3Bucket('items-to-scrape.json');

    if (items) {
      const browser = await getChrome()
      if (!browser) {
        return {
          statusCode: 500,
          body: 'Error launching Chrome',
        }
      }

      let page = await browser.newPage();
      for (const item of items) {
        //console.log("item", item)
        const available = await checkItem(page, item);
        if (available) {
          // console.log(`${item.name} is available.`);

          await sendMail({
            subject: 'Scraper Notification',
            body: `${item.name} is available. Go to url: ${item.url}`,
            recipient: process.env.SES_SENDER,
          });
        } else {
          // console.log(`${item.name} is not available.`);
        }
      }
    }

    return {
      statusCode: 200,
      body: 'success'
    }
  } catch (err) {
    console.error(err);
  }
};
