import 'dotenv/config';
import { fetchUserFollowers } from '../src/lib/twitter-api-client';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set QPS limit to 10 for this script to ensure fast execution
process.env.TWITTER_QPS_LIMIT = '10';

async function main() {
  const args = process.argv.slice(2);
  const username = args[0];

  if (!username) {
    console.error('Please provide a username as an argument.');
    console.error('Usage: npx tsx scripts/fetch-followers.ts <username>');
    process.exit(1);
  }

  console.log(`Fetching followers for user: ${username}...`);

  try {
    // Fetch all followers (high maxPages to ensure we get all)
    // Adjust maxPages if you need to limit the run for very large accounts
    const result = await fetchUserFollowers(username, {
      maxPages: 10000, 
      pageSize: 200
    });

    console.log(`Fetched ${result.totalFetched} followers.`);

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Followers');

    // Add headers
    worksheet.columns = [
      { header: 'Display Name', key: 'name', width: 30 },
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Profile URL', key: 'url', width: 40 },
      { header: 'Followers Count', key: 'followers', width: 15 },
      { header: 'Verified', key: 'verified', width: 10 },
      { header: 'Account Created', key: 'createdAt', width: 25 },
      { header: 'Description', key: 'description', width: 50 },
    ];

    // Add rows
    if (result.data) {
      result.data.forEach(follower => {
        worksheet.addRow({
          name: follower.name || 'N/A',
          username: follower.username || 'N/A',
          url: follower.username ? `https://twitter.com/${follower.username}` : 'N/A',
          followers: follower.followers,
          verified: follower.verified ? 'Yes' : 'No',
          createdAt: follower.accountCreatedAt ? follower.accountCreatedAt.toISOString().split('T')[0] : 'N/A',
          description: follower.bio || ''
        });
      });
    }

    // Save to file
    // Save to ../data relative to this script (ilpdts/scripts/ -> ilpdts/data/)
    const outputDir = path.join(__dirname, '..', 'data');
    
    if (!fs.existsSync(outputDir)) {
       fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `followers_${username}_${timestamp}.xlsx`;
    const outputPath = path.join(outputDir, filename);

    await workbook.xlsx.writeFile(outputPath);
    console.log(`Excel file saved to: ${outputPath}`);

  } catch (error) {
    console.error('Error fetching followers:', error);
    process.exit(1);
  }
}

main();
