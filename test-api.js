/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

// Read the test data
const testData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'test-engagers-data.json'), 'utf8')
);

console.log('🚀 Testing Engagers Ranking API');
console.log('📊 Test data loaded:', testData.length, 'items');
console.log('');

// Make the API call
fetch('http://localhost:3000/api/ranker/rank-engagers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(testData),
})
  .then(async (response) => {
    console.log('📡 Response Status:', response.status, response.statusText);
    console.log('');
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ SUCCESS! API Response:');
      console.log('');
      console.log('🆔 Tweet ID:', data.tweet_id);
      console.log('');
      console.log('📊 Statistics:');
      console.log('  - Total Engagers:', data.statistics.total_engagers);
      console.log('  - With Score:', data.statistics.engagers_with_score);
      console.log('  - Without Score:', data.statistics.engagers_without_score);
      console.log('  - Max Score:', data.statistics.max_score);
      console.log('  - Average Score:', data.statistics.avg_score);
      console.log('');
      console.log('🏆 Top 10 Ranked Engagers:');
      console.log('');
      
      data.ranked_engagers.slice(0, 10).forEach((engager, index) => {
        console.log(`${index + 1}. @${engager.username}`);
        console.log(`   Name: ${engager.name}`);
        console.log(`   Score: ${engager.importance_score}`);
        console.log(`   Followers: ${engager.followers?.toLocaleString() || 'N/A'}`);
        console.log(`   Verified: ${engager.verified ? '✓' : '✗'}`);
        console.log(`   Interactions: ${[
          engager.replied && 'replied',
          engager.retweeted && 'retweeted',
          engager.quoted && 'quoted'
        ].filter(Boolean).join(', ') || 'none'}`);
        
        if (engager.followed_by.length > 0) {
          console.log(`   Followed by: ${engager.followed_by.join(', ')}`);
        }
        console.log('');
      });
      
      // Save full response to file
      fs.writeFileSync(
        path.join(__dirname, 'test-api-response.json'),
        JSON.stringify(data, null, 2)
      );
      console.log('💾 Full response saved to: test-api-response.json');
      
    } else {
      console.log('❌ ERROR! API returned an error:');
      console.log(JSON.stringify(data, null, 2));
    }
  })
  .catch((error) => {
    console.error('❌ FAILED! Network or server error:');
    console.error(error.message);
    console.error('');
    console.error('Make sure:');
    console.error('1. Your dev server is running (npm run dev)');
    console.error('2. The server is accessible at http://localhost:3000');
    console.error('3. MongoDB connection is working');
  });

