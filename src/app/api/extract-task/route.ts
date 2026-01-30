import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import clientPromise from '@/lib/mongodb';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAIAPIKEY,
});

// TypeScript interface for task schema
interface Task {
  task: string;
  type: 'task' | 'idea' | 'note';
  urgency: 'low' | 'medium' | 'high' | 'urgent' | 'none';
  startDate: string | null;
  endDate: string | null;
  description: string;
  tags: string[];
  assignedTo: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text } = body;

    // Validate input
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Text input is required and cannot be empty' },
        { status: 400 }
      );
    }

    // Prevent extremely long inputs (avoid high API costs)
    if (text.length > 10000) {
      return NextResponse.json(
        { error: 'Text input too long. Please limit to 10,000 characters.' },
        { status: 400 }
      );
    }

    // Construct the LLM extraction prompt
    const prompt = `You are a structured data extractor.

Given the following message(s), extract structured information about any tasks, ideas, or notes mentioned.

Return ONLY valid JSON in this exact format (array of objects):

[
  {
    "task": "string (short title or summary)",
    "type": "task | idea | note",
    "urgency": "low | medium | high | urgent | none",
    "startDate": "ISO date string or null",
    "endDate": "ISO date string or null",
    "description": "string (1–2 sentences of context)",
    "tags": ["string"],
    "assignedTo": ["string"]
  }
]

If no valid item is found, return an empty array [].

Message:
---
${text}
---`;

    // Call OpenAI API
    console.log('Calling OpenAI API for task extraction...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0, // Deterministic output for structured extraction
    });

    const rawResponse = completion.choices[0].message.content?.trim() || '[]';
    console.log('OpenAI raw response:', rawResponse);

    // Parse JSON from LLM response (handle markdown code blocks if present)
    let tasks: Task[] = [];
    try {
      // Find JSON array in response (LLM might wrap it in markdown)
      const jsonStart = rawResponse.indexOf('[');
      const jsonEnd = rawResponse.lastIndexOf(']');
      
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('No JSON array found in LLM response');
      }

      const jsonString = rawResponse.slice(jsonStart, jsonEnd + 1);
      tasks = JSON.parse(jsonString);

      // Validate that it's an array
      if (!Array.isArray(tasks)) {
        throw new Error('LLM response is not an array');
      }
    } catch (parseError) {
      console.error('Failed to parse LLM response:', parseError);
      return NextResponse.json(
        {
          error: 'Failed to parse structured data from LLM response',
          details: parseError instanceof Error ? parseError.message : 'Unknown parsing error',
          rawResponse: rawResponse.substring(0, 500), // Return first 500 chars for debugging
        },
        { status: 500 }
      );
    }

    // If no tasks extracted, return success but with zero inserts
    if (tasks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No tasks, ideas, or notes were extracted from the text.',
        inserted: 0,
        data: [],
      });
    }

    // Connect to MongoDB and insert tasks
    console.log(`Connecting to MongoDB to insert ${tasks.length} task(s)...`);
    const client = await clientPromise;
    const db = client.db('taskdb'); // Database name
    const tasksCollection = db.collection('tasks');

    // Add timestamp to each task
    const tasksWithTimestamp = tasks.map(task => ({
      ...task,
      createdAt: new Date().toISOString(),
    }));

    const insertResult = await tasksCollection.insertMany(tasksWithTimestamp);
    console.log(`Successfully inserted ${insertResult.insertedCount} task(s) into MongoDB`);

    return NextResponse.json({
      success: true,
      message: `Successfully extracted and stored ${tasks.length} item(s)`,
      inserted: insertResult.insertedCount,
      data: tasks,
    });

  } catch (error) {
    console.error('Error in extract-task API:', error);

    // Handle OpenAI API errors
    if (error instanceof OpenAI.APIError) {
      return NextResponse.json(
        {
          error: 'OpenAI API error',
          details: error.message,
          status: error.status,
        },
        { status: 500 }
      );
    }

    // Handle MongoDB errors
    if (error && typeof error === 'object' && 'name' in error && error.name === 'MongoError') {
      return NextResponse.json(
        {
          error: 'Database error',
          details: error instanceof Error ? error.message : 'Failed to connect to MongoDB',
        },
        { status: 500 }
      );
    }

    // Generic error handler
    return NextResponse.json(
      {
        error: 'Failed to process and store tasks',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

