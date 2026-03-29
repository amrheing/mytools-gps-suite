<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

// Only allow POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

// Get POST data
$input = json_decode(file_get_contents('php://input'), true);

// Validate required fields
if (empty($input['senderName']) || empty($input['senderEmail']) || empty($input['subject']) || empty($input['message'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'All fields are required']);
    exit;
}

// Sanitize input
$senderName = htmlspecialchars(trim($input['senderName']), ENT_QUOTES, 'UTF-8');
$senderEmail = filter_var(trim($input['senderEmail']), FILTER_VALIDATE_EMAIL);
$subject = htmlspecialchars(trim($input['subject']), ENT_QUOTES, 'UTF-8');
$message = htmlspecialchars(trim($input['message']), ENT_QUOTES, 'UTF-8');

if (!$senderEmail) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid email address']);
    exit;
}

// Create email content
$to = 'bugs@amrhein.info';
$fullSubject = 'myTools Bugtracker - ' . $subject;
$emailBody = "Contact form submission from myTools website\n\n";
$emailBody .= "From: {$senderName}\n";
$emailBody .= "Email: {$senderEmail}\n";
$emailBody .= "Subject: {$subject}\n\n";
$emailBody .= "Message:\n{$message}\n\n";
$emailBody .= "---\n";
$emailBody .= "Sent from myTools Contact Form\n";
$emailBody .= "Date: " . date('Y-m-d H:i:s') . "\n";

// Email headers
$headers = [
    'From: myTools Contact Form <noreply@amrhein.info>',
    'Reply-To: ' . $senderEmail,
    'X-Mailer: PHP/' . phpversion(),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8'
];

try {
    // Try sending via SMTP (localhost:25)
    $smtp_success = false;
    
    // First try with SMTP
    if (function_exists('fsockopen')) {
        $smtp_connection = @fsockopen('localhost', 25, $errno, $errstr, 5);
        if ($smtp_connection) {
            $smtp_success = sendViaSMTP($smtp_connection, $to, $fullSubject, $emailBody, $senderEmail, $senderName);
            fclose($smtp_connection);
        }
    }
    
    // Fallback to PHP mail() if SMTP failed
    if (!$smtp_success) {
        $success = mail($to, $fullSubject, $emailBody, implode("\r\n", $headers));
    } else {
        $success = true;
    }
    
    if ($success) {
        echo json_encode(['success' => true, 'message' => 'Message sent successfully']);
    } else {
        throw new Exception('Failed to send email');
    }
    
} catch (Exception $e) {
    error_log("Contact form error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to send message. Please try again later.']);
}

function sendViaSMTP($connection, $to, $subject, $body, $fromEmail, $fromName) {
    try {
        // Read initial response
        $response = fgets($connection, 515);
        if (substr($response, 0, 3) != '220') {
            return false;
        }
        
        // HELO
        fwrite($connection, "HELO localhost\r\n");
        $response = fgets($connection, 515);
        if (substr($response, 0, 3) != '250') {
            return false;
        }
        
        // MAIL FROM
        fwrite($connection, "MAIL FROM: <noreply@amrhein.info>\r\n");
        $response = fgets($connection, 515);
        if (substr($response, 0, 3) != '250') {
            return false;
        }
        
        // RCPT TO
        fwrite($connection, "RCPT TO: <{$to}>\r\n");
        $response = fgets($connection, 515);
        if (substr($response, 0, 3) != '250') {
            return false;
        }
        
        // DATA
        fwrite($connection, "DATA\r\n");
        $response = fgets($connection, 515);
        if (substr($response, 0, 3) != '354') {
            return false;
        }
        
        // Email content
        $email_content = "From: {$fromName} <noreply@amrhein.info>\r\n";
        $email_content .= "Reply-To: {$fromEmail}\r\n";
        $email_content .= "To: {$to}\r\n";
        $email_content .= "Subject: {$subject}\r\n";
        $email_content .= "MIME-Version: 1.0\r\n";
        $email_content .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $email_content .= "\r\n";
        $email_content .= $body;
        $email_content .= "\r\n.\r\n";
        
        fwrite($connection, $email_content);
        $response = fgets($connection, 515);
        if (substr($response, 0, 3) != '250') {
            return false;
        }
        
        // QUIT
        fwrite($connection, "QUIT\r\n");
        
        return true;
        
    } catch (Exception $e) {
        return false;
    }
}
?>